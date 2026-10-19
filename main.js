import express from "express"
import { DeviceManager } from "./lib/devices.js"

const CONFIG = {
  port: 3000,
  host: "127.0.0.1"
}

/** Time to let monitors boot up between Wake-on-LAN and applying saved configs */
const WAKE_GRACE_PERIOD_MS = 5000

const app = express()
const deviceManager = new DeviceManager()

app
  .set("views", "views")
  .set("view engine", "ejs")
  .use(express.json())
  .use(express.static("public"))

// --- Pages

app.get('/', (req, res) => {
  res.render("index")
})

app.get("/device/:name", (req, res) => {
  res.render("device", { deviceName: req.params.name })
})

app.get("/add-device", (req, res) => {
  res.render("add-device")
})

// --- API: aggregated live device data for the UI
// The UI never needs to know which protocol commands produce these values.

app.get("/api/devices", async (req, res) => {
  res.json({ devices: await deviceManager.getCardData() })
})

app.get("/api/devices/:name", async (req, res) => {
  res.json(await deviceManager.getDetailData(req.params.name))
})

// --- API: saved configs

app.post("/api/devices", async (req, res) => {
  const device = await deviceManager.addDevice(req.body ?? {})
  res.status(201).json({ device })
})

app.post("/api/devices/:name/config", async (req, res) => {
  res.json(await deviceManager.saveDeviceConfig(req.params.name))
})

app.post("/api/devices/reload", async (req, res) => {
  res.json({ results: await deviceManager.applyAllSavedConfig() })
})

// --- API: helpers for the add-device page

app.post("/api/devices/test-connection", async (req, res) => {
  const { ip } = req.body ?? {}
  res.json(await deviceManager.testConnection(ip))
})

app.post("/api/devices/wake", async (req, res) => {
  const { mac } = req.body ?? {}
  res.json(await deviceManager.wakeDevice(mac))
})

// --- Error handling: DeviceManagerError turns into a JSON response with its status

app.use((err, req, res, next) => {
  const status = err.status ?? 500
  if (status >= 500) {
    console.error(err)
  }
  res.status(status).json({
    error: err.message ?? "Internal server error",
    ...(err.fields ? { fields: err.fields } : {})
  })
})

app.listen(CONFIG.port, CONFIG.host, (err) => {
  if (err) {
    console.error("Could not start server:", err)
    return
  }
  console.log(`app started on http://${CONFIG.host}:${CONFIG.port}`)
  restoreSavedDeviceConfigs()
})

/**
 * On boot: wake every configured device, give them a moment to come up, then
 * apply the saved config of whichever devices have one. Devices without saved
 * settings are not contacted by the apply step, and unreachable devices are
 * skipped and logged. Runs in the background so slow or absent hardware never
 * delays server startup.
 */
function restoreSavedDeviceConfigs() {
  deviceManager.wakeAllDevices()
    .then(results => {
      for (const result of results) {
        if (result.ok) {
          console.log(`Sent Wake-on-LAN packet to "${result.name}" (${result.mac})`)
        } else {
          console.error(`Could not send Wake-on-LAN to "${result.name}": ${result.error}`)
        }
      }
      return new Promise(resolve => {
        setTimeout(resolve, WAKE_GRACE_PERIOD_MS)
      })
    })
    .then(() => deviceManager.applyAllSavedConfig())
    .then(results => {
      for (const result of results) {
        if (result.applied) {
          console.log(`Applied saved config to "${result.name}"`)
        } else {
          console.error(`Could not apply saved config to "${result.name}": ${result.error}`)
        }
      }
    })
    .catch(err => console.error("Startup config restore failed:", err))
}