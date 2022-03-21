#!/usr/bin/env node
'use strict';

const fs = require('fs');
const mqtt = require('mqtt');
const json5 = require('json5');
const debug = require('debug')('tuya-mqtt:info');
const debugCommand = require('debug')('tuya-mqtt:command');
const debugError = require('debug')('tuya-mqtt:error');
const SimpleSwitch = require('./devices/simple-switch');
const SimpleDimmer = require('./devices/simple-dimmer');
const RGBTWLight = require('./devices/rgbtw-light');
const GenericDevice = require('./devices/generic-device');
const utils = require('./lib/utils');

var CONFIG = undefined;
let tuyaDevices = new Array();

// Setup Exit Handlers
process.on('exit', processExit.bind(0));
process.on('SIGINT', processExit.bind(0));
process.on('SIGTERM', processExit.bind(0));
process.on('uncaughtException', processExit.bind(1));

// Disconnect from and publish offline status for all devices on exit
async function processExit(exitCode) {
    for (let tuyaDevice of tuyaDevices) {
        tuyaDevice.device.disconnect();
    }
    if (exitCode || exitCode === 0) {
        debug('Exit code: '+exitCode);
    }
    await utils.sleep(1);
    process.exit();
}

// Get new deivce based on configured type
function getDevice(configDevice, mqttClient) {
    const deviceInfo = {
        configDevice: configDevice,
        mqttClient: mqttClient,
        topic: CONFIG.topic,
        useDeviceTopic: CONFIG.useDeviceTopic
    };

    switch (configDevice.type) {
        case 'SimpleSwitch':
            return new SimpleSwitch(deviceInfo);
        case 'SimpleDimmer':
            return new SimpleDimmer(deviceInfo);
        case 'RGBTWLight':
            return new RGBTWLight(deviceInfo);
    }

    return new GenericDevice(deviceInfo);
}

function initDevices(configDevices, mqttClient) {
    for (let configDevice of configDevices) {
        const newDevice = getDevice(configDevice, mqttClient);
        tuyaDevices.push(newDevice);
    }
}

// Republish devices 2x with 30 seconds sleep if restart of HA is detected
async function republishDevices() {
    for (let i = 0; i < 2; i++) {
        debug('Resending device config/state in 30 seconds');
        await utils.sleep(30);
        for (let device of tuyaDevices) {
            device.republish();
        }
        await utils.sleep(2);
    }
};

// Main code function
const main = async() => {
    let configDevices;
    let mqttClient;

    try {
        CONFIG = require('./config');
    } catch (e) {
        console.error('Configuration file not found!');
        debugError(e);
        process.exit(1);
    }

    if (typeof CONFIG.qos === 'undefined') {
        CONFIG.qos = 1;
    }

    if (typeof CONFIG.retain === 'undefined') {
        CONFIG.retain = false;
    }

    if (typeof CONFIG.useHomeAssistant === 'undefined') {
        CONFIG.useHomeAssistant = false;
    }

    if (typeof CONFIG.useDeviceTopic === 'undefined') {
        CONFIG.useDeviceTopic = false;
    }

    CONFIG.topicCount = CONFIG.topic.split('/').filter(elm => elm).length;

    try {
        configDevices = fs.readFileSync('./devices.conf', 'utf8');
        configDevices = json5.parse(configDevices);
    } catch (e) {
        console.error('Devices file not found!');
        debugError(e);
        process.exit(1);
    }

    if (!configDevices.length) {
        console.error('No devices found in devices file!');
        process.exit(1);
    }

    mqttClient = mqtt.connect({
        host: CONFIG.host,
        port: CONFIG.port,
        username: CONFIG.mqtt_user,
        password: CONFIG.mqtt_pass,
    });

    mqttClient.on('connect', function (err) {
        debug('Connection established to MQTT server');
        
        initDevices(configDevices, mqttClient);
        
        for (let tuyaDevice of tuyaDevices) {
            const deviceTopic = tuyaDevice.getBasicTopic() + "#";
            debug('Subscribe to device topic -> ' + deviceTopic);
            mqttClient.subscribe(deviceTopic);
        }
        
        if(CONFIG.useHomeAssistant) {
            mqttClient.subscribe('homeassistant/status');
            mqttClient.subscribe('hass/status');
        }

    });

    mqttClient.on('reconnect', function (error) {
        if (mqttClient.connected) {
            debug('Connection to MQTT server lost. Attempting to reconnect...');
        } else {
            debug('Unable to connect to MQTT server');
        }
    });

    mqttClient.on('error', function (error) {
        debug('Unable to connect to MQTT server', error);
    });

    mqttClient.on('message', function (topic, message) {
        try {
            message = message.toString();
            const splitTopic = topic.split('/');
            const deviceTopics = splitTopic.slice(CONFIG.topicCount);
            const topicLength = deviceTopics.length;
            const commandTopic = deviceTopics[topicLength - 1];

            if(CONFIG.useHomeAssistant) {
                if (topic === 'homeassistant/status' || topic === 'hass/status' ) {
                    debug('Home Assistant state topic '+topic+' received message: '+message);
                    if (message === 'online') {
                        republishDevices();
                    }
                }
            }
            
            if (commandTopic.includes('cmnd')) {
                // If it looks like a valid command topic try to process it
                debugCommand('Received MQTT message -> ', JSON.stringify({
                    topic: topic,
                    message: message
                }));

                // Use device topic level to find matching device
                const device = tuyaDevices.find(d => topic.includes(d.baseTopic));
                switch (topicLength) {
                    case 1:
                        device.processCommand(message, commandTopic);
                        break;
                    case 2:
                        device.processDpsCommand(message);
                        break;
                    case 3:
                        const dpsKey = splitTopic[topicLength-2];
                        device.processDpsKeyCommand(message, dpsKey);
                        break;
                }
            }
        } catch (e) {
            debugError(e);
        }
    });
};

// Call the main code
main();