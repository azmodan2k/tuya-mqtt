FROM node:latest

WORKDIR /opt/tuya-mqtt

RUN apt-get update
RUN apt-get install -y --no-install-recommends apt-transport-https ca-certificates curl netbase wget
RUN apt-get install -y --no-install-recommends git

RUN git clone https://github.com/azmodan2k/tuya-mqtt.git /opt/tuya-mqtt

# COPY ./devices/* ./devices/
# COPY ./lib/* ./lib/
# COPY ./package.json .
# COPY ./merge-devices.js .
# COPY ./tuya-mqtt.js .

RUN npm install

#ENV DEBUG=tuya-mqtt:*,TuyAPI
ENV DEBUG=tuya-mqtt:*
#ENV DEBUG=TuyAPI

CMD ["node", "tuya-mqtt.js"]
