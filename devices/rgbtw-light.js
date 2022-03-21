const TuyaDevice = require('./tuya-device');
const debug = require('debug')('tuya-mqtt:device-detect');
const debugColor = require('debug')('tuya-mqtt:color');
const debugScene = require('debug')('tuya-mqtt:scene');
const debugDiscovery = require('debug')('tuya-mqtt:discovery');
const utils = require('../lib/utils');

class RGBTWLight extends TuyaDevice {
    async init() {
        // If no manual config try to detect device settings
        if (!this.config.dpsPower) { 
            await this.guessLightInfo()
        }

        // If detection failed and no manual config return without initializing
        if (!this.guess.dpsPower && !this.config.dpsPower) {
            debug('Automatic discovery of Tuya bulb settings failed and no manual configuration') 
            return
        }     

        // Set device specific variables
        this.config.dpsPower = this.config.dpsPower ? this.config.dpsPower : this.guess.dpsPower
        this.config.dpsMode = this.config.dpsMode ? this.config.dpsMode : this.guess.dpsMode
        this.config.dpsWhiteValue = this.config.dpsWhiteValue ? this.config.dpsWhiteValue : this.guess.dpsWhiteValue
        this.config.whiteValueScale = this.config.whiteValueScale ? this.config.whiteValueScale : this.guess.whiteValueScale
        this.config.dpsColorTemp = this.config.dpsColorTemp ? this.config.dpsColorTemp : this.guess.dpsColorTemp
        this.config.minColorTemp = this.config.minColorTemp ? this.config.minColorTemp : 154 // ~6500K
        this.config.maxColorTemp = this.config.maxColorTemp ? this.config.maxColorTemp : 400 // ~2500K
        this.config.colorTempScale = this.config.colorTempScale ? this.config.colorTempScale : this.guess.colorTempScale
        this.config.dpsColor = this.config.dpsColor ? this.config.dpsColor : this.guess.dpsColor
        this.config.colorType = this.config.colorType ? this.config.colorType : this.guess.colorType
        this.config.dpsScene = this.config.dpsScene ? this.config.dpsScene : this.guess.dpsScene

        this.deviceData.mdl = 'RGBTW Light'
        this.isRgbtwLight = true

        // Set white value transform math
        let whiteValueStateMath
        let whiteValueCommandMath
        if (this.config.whiteValueScale === 255) {
            // Devices with brightness scale of 255 seem to not allow values
            // less then 25 (10%) without producing timeout errors.
            whiteValueStateMath = '/2.3-10.86'
            whiteValueCommandMath = '*2.3+25'
        } else {
            // For other scale (usually 1000), 10-1000 seems OK.
            whiteValueStateMath = '/('+this.config.whiteValueScale+'/100)'
            whiteValueCommandMath = '*('+this.config.whiteValueScale+'/100)'
        }

        // Map generic DPS topics to device specific topic names
        this.deviceTopics = {
            state: {
                key: this.config.dpsPower,
                type: 'bool'
            },
            white_brightness_state: { 
                key: this.config.dpsWhiteValue,
                type: 'int',
                topicMin: 0,
                topicMax: 100,
                stateMath: whiteValueStateMath,
                commandMath: whiteValueCommandMath
            },
            hs_state: {
                key: this.config.dpsColor,
                type: this.config.colorType,
                components: 'h,s'
            },
            color_brightness_state: {
                key: this.config.dpsColor,
                type: this.config.colorType,
                components: 'b'
            },
            hsb_state: {
                key: this.config.dpsColor,
                type: this.config.colorType,
                components: 'h,s,b'
            },
            hex_state: {
                key: this.config.dpsColor,
                type: 'hex',
                components: 'h,s,b'
            },
            predefinedColors_state: {
                key: this.config.dpsColor,
                type: 'predefinedColors',
                components: 'h,s,b'
            },
            predefinedScenes_state: {
                key: this.config.dpsScene,
                type: 'predefinedScenes',
                components: 'str'
            },
            mode_state: {
                key: this.config.dpsMode,
                type: 'str'
            }
        };

        this.predefinedColors = [
            { "name": "red", "colorHex": "#FF0000" },
            { "name": "maroon", "colorHex": "#800000" },
            { "name": "yellow", "colorHex": "#FFFF00" },
            { "name": "olive", "colorHex": "#808000" },
            { "name": "lime", "colorHex": "#00FF00" },
            { "name": "green", "colorHex": "#008000" },
            { "name": "aqua", "colorHex": "#00FFFF" },
            { "name": "teal", "colorHex": "#008080" },
            { "name": "blue", "colorHex": "#0000FF" },
            { "name": "navy", "colorHex": "#000080" },
            { "name": "fuchsia", "colorHex": "#FF00FF" },
            { "name": "purple", "colorHex": "#800080" }
        ];        
        this.currentPredefinedColor = "red";

        this.predefinedScenes = [
            { "name": "night", "code": "000e0d0000000000000000c803e8" },
            { "name": "read", "code": "010e0d0000000000000003e803e8" },
            { "name": "working", "code": "020e0d0000000000000003e803e8" },
            { "name": "leisure", "code": "030e0d0000000000000001f403e8" },
            { "name": "soft", "code": "04464602007803e803e800000000464602007803e8000a00000000" },
            { "name": "colorful", "code": "05464601000003e803e800000000464601007803e803e80000000046460100f003e803e800000000464601003d03e803e80000000046460100ae03e803e800000000464601011303e803e800000000" },
            { "name": "dazzling", "code": "06464601000003e803e800000000464601007803e803e80000000046460100f003e803e800000000" },
            { "name": "gorgeous", "code": "07464602000003e803e800000000464602007803e803e80000000046460200f003e803e800000000464602003d03e803e80000000046460200ae03e803e800000000464602011303e803e800000000" }
        ];    
        this.currentPredefinedScene = "night";

        // If device supports Color Temperature add color temp device topic
        if (this.config.dpsColorTemp) {
            // Values used for tranforming from 1-255 scale to mireds range
            const rangeFactor = (this.config.maxColorTemp-this.config.minColorTemp)/100
            const scaleFactor = this.config.colorTempScale/100
            const tuyaMaxColorTemp = this.config.maxColorTemp/rangeFactor*scaleFactor

            this.deviceTopics.color_temp_state = {
                key: this.config.dpsColorTemp,
                type: 'int',
                topicMin: this.config.minColorTemp,
                topicMax: this.config.maxColorTemp,
                stateMath: '/'+scaleFactor+'*-'+rangeFactor+'+'+this.config.maxColorTemp,
                commandMath: '/'+rangeFactor+'*-'+scaleFactor+'+'+tuyaMaxColorTemp
            }
        }

        // Send home assistant discovery data and give it a second before sending state updates
        this.initDiscovery()
        await utils.sleep(1)

        // Get initial states and start publishing topics
        this.getStates()
    }

    getNextPredefinedColor(newColor) {
        if(newColor === 'next') {
            debugColor('get next color by index');

            var currentIndex = this.predefinedColors.indexOf(this.predefinedColors.find(f => f.name === this.currentPredefinedColor));
            var nextIndex = currentIndex + 1;
            nextIndex = nextIndex % this.predefinedColors.length;
    
            return this.predefinedColors[nextIndex];
        }

        if(newColor === 'prev') {
            debugColor('get prev color by index');

            var currentIndex = this.predefinedColors.indexOf(this.predefinedColors.find(f => f.name === this.currentPredefinedColor));
            var nextIndex = currentIndex - 1;
            if(nextIndex < 0) { nextIndex = this.predefinedColors.length - 1; }
    
            return this.predefinedColors[nextIndex];
        }

        debugColor('get next color by color wish ' + newColor);
        var nextColor = this.predefinedColors.find(f => f.name === newColor);
        debugColor('found nextColor ' + nextColor.name);

        if(!nextColor) {
            return this.getNextPredefinedColor('next');
        }

        return nextColor;
    }

    getNextPredefinedScene(newScene) {
        if(newScene === 'next') {
            debugScene('get next scene by index');

            var currentIndex = this.predefinedScenes.indexOf(this.predefinedScenes.find(f => f.name === this.currentPredefinedScene));
            var nextIndex = currentIndex + 1;
            nextIndex = nextIndex % this.predefinedScenes.length;
    
            return this.predefinedScenes[nextIndex];
        }

        if(newScene === 'prev') {
            debugScene('get prev scene by index');

            var currentIndex = this.predefinedScenes.indexOf(this.predefinedScenes.find(f => f.name === this.currentPredefinedScene));
            var nextIndex = currentIndex - 1;
            if(nextIndex < 0) { nextIndex = this.predefinedScenes.length - 1; }
    
            return this.predefinedScenes[nextIndex];
        }

        debugScene('get next scene by scene wish ' + newScene);
        var nextScene = this.predefinedScenes.find(f => f.name === newScene);
        debugScene('found nextScene ' + nextScene.name);

        if(!nextScene) {
            return this.predefinedScenes('next');
        }

        return nextScene;
    }

    initDiscovery() {
        const configTopic = 'homeassistant/light/'+this.config.id+'/config'

        const discoveryData = {
            name: (this.config.name) ? this.config.name : this.config.id,
            state_topic: this.baseTopic+'state',
            command_topic: this.baseTopic+'cmnd',
            brightness_state_topic: this.baseTopic+'color_brightness_state',
            brightness_command_topic: this.baseTopic+'color_brightness_cmnd',
            brightness_scale: 100,
            hs_state_topic: this.baseTopic+'hs_state',
            hs_command_topic: this.baseTopic+'hs_cmnd',
            white_value_state_topic: this.baseTopic+'white_brightness_state',
            white_value_command_topic: this.baseTopic+'white_brightness_cmnd',
            white_value_scale: 100,
            availability_topic: this.baseTopic+'LWT',
            payload_available: 'online',
            payload_not_available: 'offline',
            unique_id: this.config.id,
            device: this.deviceData
        }

        if (this.config.dpsColorTemp) {
            discoveryData.color_temp_state_topic = this.baseTopic+'color_temp_state'
            discoveryData.color_temp_command_topic = this.baseTopic+'color_temp_cmnd'
            discoveryData.min_mireds = this.config.minColorTemp
            discoveryData.max_mireds = this.config.maxColorTemp
        }

        debugDiscovery('Home Assistant config topic: '+configTopic)
        debugDiscovery(discoveryData)
        this.publishMqtt(configTopic, JSON.stringify(discoveryData))
    }

    async guessLightInfo() {
        this.guess = new Object()
        debug('Attempting to detect light capabilites and DPS values...')
        debug('Querying DPS 2 for white/color mode setting...')

        // Check if DPS 2 contains typical values for RGBTW light
        const mode2 = await this.device.get({"dps": 2})
        const mode21 = await this.device.get({"dps": 21})
        if (mode2 && (mode2 === 'white' || mode2 === 'colour' || mode2.toString().includes('scene'))) {
            debug('Detected likely Tuya color bulb at DPS 1-5, checking more details...')
            this.guess = {'dpsPower': 1, 'dpsMode': 2, 'dpsWhiteValue': 3, 'whiteValueScale': 255, 'dpsColorTemp': 4, 'colorTempScale': 255, 'dpsColor': 5}
        } else if (mode21 && (mode21 === 'white' || mode21 === 'colour' || mode21.toString().includes('scene'))) {
            debug('Detected likely Tuya color bulb at DPS 20-25, checking more details...')
            this.guess = {'dpsPower': 20, 'dpsMode': 21, 'dpsWhiteValue': 22, 'whiteValueScale': 1000, 'dpsColorTemp': 23, 'colorTempScale': 1000, 'dpsColor': 24, 'dpsScene': 25}
        }

        if (this.guess.dpsPower) {
            debug('Attempting to detect if bulb supports color temperature...')
            const colorTemp = await this.device.get({"dps": this.guess.dpsColorTemp})
            if (colorTemp !== '' && colorTemp >= 0 && colorTemp <= this.guess.colorTempScale) {
                debug('Detected likely color temperature support')
            } else {
                debug('No color temperature support detected')
                this.guess.dpsColorTemp = 0
            }
            debug('Attempting to detect Tuya color format used by device...')
            const color = await this.device.get({"dps": this.guess.dpsColor})
            if (this.guess.dpsPower === 1) {
                this.guess.colorType = (color && color.length === 12) ? 'hsb' : 'hsbhex'
            } else {
                this.guess.colorType = (color && color.length === 14) ? 'hsbhex' : 'hsb'
            }
            debug ('Detected Tuya color format '+this.guess.colorType.toUpperCase())
        }
    }
}

module.exports = RGBTWLight