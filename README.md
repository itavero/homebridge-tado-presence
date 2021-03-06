> **ARCHIVED**: Tado now offers a button in their own app to toggle this behavior. For me this is good enough, so I'm not planning to continue to work on this particular Homebridge plugin.

# Homebridge Tado Presence 🔥
Presents a control in HomeKit to switch your Tado system between Home and Away mode.
This means you can automate the presence using geofencing triggers from HomeKit.

Note that this plugin works best if you do not have any other geofencing setup for your Tado system.
It will add a fake mobile device to your account and update it's location appropriately.

Besides that it will also call the endpoint used by the Tado app to switch between Home and Away.
Home can only be activated if at least one person is within the geofence (hence the fake mobile device).
Away can only be activated if no one is within the geofence (hence the suggestion to turn off the geofencing feature in the Tado app on your real smartphones).

## Improvements
The plugin uses an old authentication mechanism and I would not be surprised if Tado would deprecate this in the near future.
Also, I think it will be pretty easy to spot for the Tado engineers that this plugin is being used, so they might attempt to block it.

Besides that I need to make a tool to clean up the fake mobile device if, for whatever reason, you decide to stop using this plugin.

## Installation and usage
_To Do_ : Publish this package somewhere once it is finished.

Add the following accessory to your Homebridge config file, using your Tado credentials:
```json
{
  "accessories": [
    {
      "accessory": "TadoPresence",
      "name": "My Tado Heating System",
      "email": "account@example.com",
      "password": "my-super-secret-password"
    }
  ]
}
```

### Considerations / remarks
* The location of your Tado home is determined on power up. If it is changed, you need to restart Homebridge.
* A "fake" mobile device named "HomeBridge" will be added to your account.
* This is the first project I've ever done in TypeScript.. I'm sure a lot of things need to be cleaned up. 🧹
