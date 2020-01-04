require("@babel/polyfill");
import callbackify from "./util/callbackify";

const API_PREFIX = "https://my.tado.com/api/v2/";
const FAKE_PHONE_MODEL = "FakePhone1,1";
const rp = require('request-promise-native');

let Service: any;
let Characteristic: any;

export default function (homebridge: any) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerAccessory("homebridge-tado-presence", "TadoPresence", TadoPresenceAccessory);
}

class TadoPresenceAccessory {
    log: Function;
    name: string;
    email: string;
    password: string;
    homeId: number;
    deviceId: number;
    interval: number;
    geoconfig: GeolocationConfig | null;
    alternateLocation : Geolocation;
    haveUpdatedSetting : boolean;

    informationService: any;
    presenceService: any;

    actualState: boolean;


    constructor(log, config) {
        this.log = log;
        this.name = config["name"];
        this.email = config["email"];
        this.password = config["password"];
        this.homeId = config["home_id"];
        this.deviceId = config["device_id"];
        this.interval = config["interval"] || 10;
        this.actualState = true;
        this.geoconfig = null;
        this.alternateLocation = {
            latitude: 48.168310,
            longitude: 11.537140
        };
        this.haveUpdatedSetting = false;

        this.log("constructor");

        this.informationService = new Service.AccessoryInformation();
        this.informationService
            .setCharacteristic(Characteristic.Manufacturer, "tado")
            .setCharacteristic(Characteristic.Model, "Home/Away Switch");
        if (this.homeId !== undefined || this.homeId < 1) {
            this.informationService.setCharacteristic(Characteristic.SerialNumber, this.homeId.toString());
        } else {
            this.informationService.setCharacteristic(Characteristic.SerialNumber, "SingleHome");
        }

        this.presenceService = new Service.Switch(this.name);
        this.presenceService
            .getCharacteristic(Characteristic.On)
            .on("get", callbackify(this.getCurrentOnState))
            .on("set", callbackify(this.setOnState));
    }

    getServices() {
        this.log("getServices");
        const {informationService, presenceService} = this;
        return [informationService, presenceService];
    }

    getCurrentOnState = async () => {
        this.log("getCurrentOnState");
        await this.homeAndDeviceSetup();
        await this.pullActualPresence();
        return this.actualState;
    };

    setOnState = async state => {
        this.log("setOnState: %s", state.toString());
        await this.homeAndDeviceSetup();
        if (this.geoconfig != null) {
            let location = (state) ? this.geoconfig.home.geolocation : this.alternateLocation;
            await this.moveFakeDeviceTo(location);
            await this.pushNewPresence(state);
        }
        this.actualState = state;
    };

    private getAuthQueryString() {
        return {username: this.email, password: this.password}
    }

    private getDefaultFakeDeviceSettings() : MobileDeviceSettings {
        return {
            geoTrackingEnabled: true,
            onDemandLogRetrievalEnabled: false,
            pushNotifications: {
                awayModeReminder: false,
                energySavingsReportReminder: false,
                homeModeReminder: false,
                lowBatteryReminder: false,
                openWindowReminder: false
            }
        };
    }

    private async homeAndDeviceSetup() {
        await this.determineHomeId();
        await this.createFakeMobileDevice();
        await this.determineGeoLocation();
    }

    private generateAlternateLocation() {
        if (this.geoconfig != null) {
            const distanceInMeter = Math.ceil(Math.random() * (40000)) + 10000;
            const bearing = Math.floor(Math.random() * 359);
            // todo: calculate fake location
        }
    }

    private async determineHomeId() {
        if (this.homeId === undefined || this.homeId < 1) {
            this.log("Discover home_id");
            let result = await this.apiGet<GetHomesResponse>("me");
            this.log(result);
            let foundOne = false;
            if (result != null) {
                let foundMultiple = false;
                for (let home of result.homes) {
                    if (foundOne) {
                        foundMultiple = true;
                    }
                    foundOne = true;

                    this.homeId = home.id;
                    this.log("Found home '%s' (home_id: %s )", home.name, home.id);
                }

                if (foundMultiple) {
                    this.log("Found multiple homes");
                    throw new Error("Found multiple homes. Configure homebridge to use only one using the home_id property.");
                }
            }
            if (!foundOne) {
                this.log("No homes found");
                throw new Error("Failed to retrieve homes.");
            }
        }
    }

    private async determineGeoLocation() {
        if (this.geoconfig == null) {
            this.geoconfig = await this.apiGet<GeolocationConfig>("homes/" + this.homeId.toString() + "/mobileDevices/" + this.deviceId.toString() + "/geolocationConfig")
            if (this.geoconfig == null) {
                this.log("Could not retrieve geolocation configuraiton for home %s and device %s.", this.homeId, this.deviceId);
                throw new Error("Failed to retrieve geolocation configuration.");
            } else {
                this.generateAlternateLocation();
            }
        }
    }

    private async determineMobileDeviceId(): Promise<number | null> {
        let identifier: number | null = null;
        let result = await this.apiGet<MobileDevicesResponse[]>("homes/" + this.homeId.toString() + "/mobileDevices")
        if (result != null) {
            let nonFakeWithGeoLocation: string[] = [];
            for (let dev of result) {
                if (dev.deviceMetadata.model == FAKE_PHONE_MODEL) {
                    this.log("Found fake device '%s' (device_id: %s )", dev.name, dev.id);
                    identifier = dev.id;
                } else {
                    // Probably a real device.
                    if (dev.settings.geoTrackingEnabled) {
                        nonFakeWithGeoLocation.push(dev.name);
                    }
                }
            }
            if (nonFakeWithGeoLocation.length > 0) {
                this.log("WARNING: Found other mobile device(s) that have geotracking enabled. It is recommended to turn it off (device: %s)", nonFakeWithGeoLocation.join(", "));
            }
        }
        return identifier;
    }

    private async moveFakeDeviceTo(location : Geolocation) {
        if (this.geoconfig == null) {
            throw new Error("Geoconfig not loaded");
        }

        const randomAccuracy = Math.ceil((Math.random() * this.geoconfig.desiredAccuracy) + (this.geoconfig.desiredAccuracy / 2));
        const now = new Date();

        var data : GeolocationUpdate = {
            geolocation: location,
            accuracy: randomAccuracy,
            acquisitionMode: 'GEOFENCING',
            timestamp: now,
            locationTimestamp: now
        };

        this.log("moveFakeDeviceTo");
        var result = await this.apiSend<any>("PUT", "homes/" + this.homeId.toString() + "/mobileDevices/" + this.deviceId.toString() + "/geolocationFix", data);
        this.log(result);
    }

    private async pushNewPresence(atHome : boolean) {
        const data = { homePresence: (atHome) ? "HOME" : "AWAY" };

        this.log("updatePresence");
        var result = await this.apiSend<any>("PUT", "homes/" + this.homeId.toString() + "/presence", data);
        this.log(result);
    }

    private async pullActualPresence() {
        var result = await this.apiGet<HomeState>("homes/" + this.homeId.toString() + "/state");
        if (result != null) {
            this.actualState = (result.presence == 'HOME');
        } else {
            this.log("Failed to get actual state from API");
        }
    }

    private async enableGeofencingForFakeDevice() {
        var result = await this.apiSend<any>("PUT", "homes/" + this.homeId.toString() + "/mobileDevices/" + this.deviceId.toString() + "/settings", this.getDefaultFakeDeviceSettings());
        this.log(result);
    }

    private async createFakeMobileDevice() {
        if (this.deviceId !== undefined || this.deviceId > 0) {
            // Device ID already set
            if (!this.haveUpdatedSetting) {
                this.enableGeofencingForFakeDevice();
                this.haveUpdatedSetting = true;
            }
            return;
        }

        var deviceId = await this.determineMobileDeviceId();
        if (deviceId != null) {
            // Fake mobile device was already found.
            this.deviceId = deviceId;
            if (!this.haveUpdatedSetting) {
                this.enableGeofencingForFakeDevice();
                this.haveUpdatedSetting = true;
            }
            return;
        }

        // Create a new fake device
        this.log("Create a fake mobile device");
        let data: CreateMobileDeviceRequest = {
            name: "HomeBridge",
            metadata: {
                device: {
                    locale: "en",
                    model: FAKE_PHONE_MODEL,
                    osVersion: "13.3.7",
                    platform: "Android"
                },
                tadoApp: {
                    version: "0.1 (0001)"
                }
            },
            settings: this.getDefaultFakeDeviceSettings()
        };
        let result = await this.apiSend<MobileDevicesResponse>('POST', "homes/" + this.homeId.toString() + "/mobileDevices", data);
        if (result != null) {
            this.deviceId = result.id;
            this.log("New mobile device created with device_id: %s", this.deviceId);
        } else {
            throw new Error("Failed to create fake mobile device.");
        }
    }

    private async apiGet<T>(path: string): Promise<T | null> {
        let options = {
            uri: API_PREFIX + path,
            qs: this.getAuthQueryString(),
            json: true
        };

        let result: T | null = null;
        await rp.get(options)
            .then((body) => {
                result = <T>body;
            })
            .catch((err) => {
                this.log("Error while calling GET %s: %s", path, err);
            });

        return result;
    }

    private async apiSend<T>(method: string, path: string, body: any): Promise<T | null> {
        let options = {
            method: method,
            uri: API_PREFIX + path,
            qs: this.getAuthQueryString(),
            json: true,
            body: body
        };

        let result: T | null = null;
        await rp(options)
            .then((body) => {
                result = <T>body;
            })
            .catch((err) => {
                this.log("Error while calling GET %s: %s", path, err);
            });

        return result;
    }
}

interface HomeEntry {
    id: number;
    name: string;
}

interface GetHomesResponse {
    homes: HomeEntry[];
}

interface MobileDeviceNotificationSettings {
    lowBatteryReminder: boolean;
    awayModeReminder: boolean;
    homeModeReminder: boolean;
    openWindowReminder: boolean;
    energySavingsReportReminder: boolean;
}

interface MobileDeviceSettings {
    geoTrackingEnabled: boolean;
    onDemandLogRetrievalEnabled: boolean;
    pushNotifications: MobileDeviceNotificationSettings;
}

interface MobileDeviceDeviceMetadata {
    platform: string;
    osVersion: string;
    model: string;
    locale: string;
}

interface MobileDevicesResponse {
    name: string;
    id: number;
    settings: MobileDeviceSettings;
    deviceMetadata: MobileDeviceDeviceMetadata;
}

interface TadoAppMetadata {
    version: string;
}

interface MobileDeviceMetadata {
    device: MobileDeviceDeviceMetadata;
    tadoApp: TadoAppMetadata;
}

interface CreateMobileDeviceRequest {
    name: string;
    metadata: MobileDeviceMetadata;
    settings: MobileDeviceSettings;
}

interface Geolocation {
    latitude: number;
    longitude: number;
}

interface GeoHome {
    geolocation: Geolocation;
}

interface GeolocationConfig {
    home: GeoHome;
    desiredAccuracy: number;
}

interface GeolocationUpdate {
    geolocation: Geolocation;
    timestamp: Date;
    locationTimestamp: Date;
    acquisitionMode: string;
    accuracy: number;
}

interface HomeState {
    presence: string;
}