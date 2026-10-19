import { readFileSync, writeFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import wol from "wake_on_lan"
import { NewLineDeviceController } from "./newline-controls.js"
import logger from "./logger.js"

/** Default location of the device list + saved configs */
const DEFAULT_CONFIG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../config.json"
)

/** Volume and backlight brightness share a 0-100 range */
const MAX_LEVEL = 100

/** Queryable display modes mapped back to their control codes */
const DISPLAY_MODE_CODES = {
  standard: 0,
  eco: 1,
  custom: 2
}

const IPV4_PATTERN = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

/** Module-scoped logger child */
const log = logger.child({ module: "devices" })

/**
 * @typedef {Object} DeviceRecord
 * @property {string} ip
 * @property {string} mac
 * @property {string} name
 * @property {Object | null} settings Saved config captured from the device, if any
 * @property {Object} raw Original config.json entry, preserved so unknown fields survive a rewrite
 * @property {NewLineDeviceController | null} controller Lazily created TCP connection
 * @property {Promise<void>} queue Tail of the per-device command queue
 */

/** Error that knows the HTTP status the API layer should respond with */
export class DeviceManagerError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {Object<string, string>} [fields] per-field error details for form submissions
   */
  constructor(message, status = 500, fields) {
    super(message)
    this.name = "DeviceManagerError"
    this.status = status
    if (fields) {
      this.fields = fields
    }
  }
}

export class DeviceManager {
  /** @type {DeviceRecord[]} */
  #devices = []
  /** @type {string} */
  #configPath

  /**
   * @param {string} [configPath] defaults to config.json in the project root
   */
  constructor(configPath = DEFAULT_CONFIG_PATH) {
    this.#configPath = configPath
    this.#devices = this.#loadConfigSync()
  }

  /**
   * Loads config.json at startup, creating an empty one when it is missing.
   * A malformed file is treated as fatal so we never silently overwrite real
   * data.
   * @returns {DeviceRecord[]}
   */
  #loadConfigSync() {
    /** @type {any} */
    let parsed
    try {
      parsed = JSON.parse(readFileSync(this.#configPath, "utf8"))
    } catch (/** @type {any} */ err) {
      if (err.code === "ENOENT") {
        this.#createEmptyConfig()
        return []
      }
      throw new Error(`Could not read config file ${this.#configPath}: ${err.message}`)
    }

    const entries = Array.isArray(parsed?.devices) ? parsed.devices : []
    return entries
      .filter(entry => typeof entry?.ip === "string" && typeof entry?.mac === "string" && typeof entry?.name === "string")
      .map(entry => this.#toRecord(entry))
  }

  /**
   * @param {Object} entry raw config.json entry
   * @returns {DeviceRecord}
   */
  #toRecord(entry) {
    return {
      ip: entry.ip,
      mac: entry.mac,
      name: entry.name,
      settings: typeof entry.settings === "object" && entry.settings !== null ? entry.settings : null,
      raw: entry,
      controller: null,
      queue: Promise.resolve()
    }
  }

  /**
   * Serializes every command for one device. The protocol has no request IDs,
   * so multiple in-flight commands on a shared socket could swap responses.
   * Failed commands detach the controller so the next command reconnects.
   * @template T
   * @param {DeviceRecord} device
   * @param {(controller: NewLineDeviceController) => Promise<T>} operation
   * @returns {Promise<T>}
   */
  #runQueued(device, operation) {
    const task = device.queue.then(async () => {
      const controller = this.#getController(device)
      try {
        return await operation(controller)
      } catch (err) {
        log.warn({ device: device.name, err }, "Device command failed; dropping connection for reconnect")
        this.#discardController(device)
        throw err
      }
    })
    device.queue = task.then(() => {}, () => {})
    return task
  }

  /**
   * Reuses a device's live connection, or opens a fresh one when the previous
   * socket was destroyed or dropped.
   * @param {DeviceRecord} device
   * @returns {NewLineDeviceController}
   */
  #getController(device) {
    if (!device.controller || device.controller.socket.destroyed) {
      const controller = new NewLineDeviceController({
        ipAddress: device.ip,
        macAddress: device.mac
      })
      // Forget this socket when the monitor drops the connection so the
      // next command opens a fresh one. Guarded in case a replacement
      // controller was already created when the close event arrives.
      controller.socket.once("close", () => {
        if (device.controller === controller) {
          device.controller = null
        }
      })
      device.controller = controller
    }
    return device.controller
  }

  /**
   * @param {DeviceRecord} device
   */
  #discardController(device) {
    const controller = device.controller
    device.controller = null
    try {
      controller?.socket.destroy()
    } catch {
      // socket already gone
    }
  }

  /**
   * @param {string} name
   * @returns {DeviceRecord}
   */
  #requireDevice(name) {
    const device = this.#devices.find(device => device.name === name)
    if (!device) {
      throw new DeviceManagerError(`Unknown device "${name}"`, 404)
    }
    return device
  }

  /**
   * Live card-view summary for every configured device, fetched in parallel.
   * Devices that cannot be reached report `online: false` instead of failing
   * the whole request. Serves fresh data only — nothing read from config.json.
   * @returns {Promise<Array<{name: string, ip: string, online: boolean, power: string | null, mute: string | null, input: string | null}>>}
   */
  async getCardData() {
    return Promise.all(this.#devices.map(device => this.#getCardForDevice(device)))
  }

  /**
   * @param {DeviceRecord} device
   * @returns {Promise<{name: string, ip: string, online: boolean, power: string | null, mute: string | null, input: string | null}>}
   */
  async #getCardForDevice(device) {
    try {
      const state = await this.#runQueued(device, async controller => ({
        power: await controller.queryPower(),
        mute: await controller.queryMute(),
        input: await controller.queryCurrentSignalSource()
      }))
      return {
        name: device.name,
        ip: device.ip,
        online: true,
        power: state.power,
        mute: state.mute,
        input: state.input
      }
    } catch {
      return { name: device.name, ip: device.ip, online: false, power: "off", mute: null, input: null }
    }
  }

  /**
   * Every data point the device can report, fetched live.
   * Unreachable devices return `online: false` with all live fields null.
   * `savedSettings` is config-file metadata, not device data.
   * @param {string} name
   */
  async getDetailData(name) {
    const device = this.#requireDevice(name)
    try {
      const state = await this.#runQueued(device, async controller => ({
        power: await controller.queryPower(),
        mute: await controller.queryMute(),
        input: await controller.queryCurrentSignalSource(),
        volume: await controller.queryVolume(),
        displayMode: await controller.queryDisplayMode(),
        backlight: await controller.queryBacklightStatus(),
        backlightBrightness: await controller.queryBacklightBrightness(),
        sleep: await controller.querySleepModeStatus()
      }))
      return { name: device.name, ip: device.ip, online: true, savedSettings: device.settings, ...state }
    } catch {
      return {
        name: device.name,
        ip: device.ip,
        online: false,
        savedSettings: device.settings,
        power: null,
        mute: null,
        input: null,
        volume: null,
        displayMode: null,
        backlight: null,
        backlightBrightness: null,
        sleep: null
      }
    }
  }

  // --- Direct controls (power, mute)

  /**
   * Powers a device on via Wake-on-LAN or off via the control protocol.
   * The "on" case only fires the magic packet — a freshly woken monitor
   * cannot accept TCP commands yet.
   * @param {string} name
   * @param {"on" | "off"} desiredPower
   * @returns {Promise<{name: string, power: "on" | "off"}>}
   */
  async setDevicePower(name, desiredPower) {
    const device = this.#requireDevice(name)
    if (desiredPower !== "on" && desiredPower !== "off") {
      throw new DeviceManagerError('Power must be "on" or "off"', 400)
    }
    if (desiredPower === "on") {
      await this.#sendMagicPacket(device.mac)
      return { name: device.name, power: "on" }
    }
    await this.#runAckedCommand(device, "power it off", controller => controller.powerOff())
    return { name: device.name, power: "off" }
  }

  /**
   * Mutes or unmutes a device.
   * @param {string} name
   * @param {"muted" | "unmuted"} desiredMute
   * @returns {Promise<{name: string, mute: "muted" | "unmuted"}>}
   */
  async setDeviceMute(name, desiredMute) {
    const device = this.#requireDevice(name)
    if (desiredMute !== "muted" && desiredMute !== "unmuted") {
      throw new DeviceManagerError('Mute must be "muted" or "unmuted"', 400)
    }
    await this.#runAckedCommand(device, "change its mute state", controller =>
      desiredMute === "muted" ? controller.muteOn() : controller.muteOff()
    )
    return { name: device.name, mute: desiredMute }
  }

  /**
   * Powers every configured device: "on" sends Wake-on-LAN to all devices
   * without checking their state, "off" only targets devices that report
   * themselves as on. Individual failures are reported, never thrown.
   * @param {"on" | "off"} desiredPower
   * @returns {Promise<Array<{name: string, ok: boolean, alreadyOff?: boolean, error?: string}>>}
   */
  async powerAllDevices(desiredPower) {
    if (desiredPower === "on") {
      const results = await this.wakeAllDevices()
      return results.map(result => ({
        name: result.name,
        ok: result.ok,
        ...(result.error ? { error: result.error } : {})
      }))
    }
    if (desiredPower === "off") {
      return Promise.all(this.#devices.map(async device => {
        try {
          const power = await this.#runQueued(device, controller => controller.queryPower())
          if (power === "off") {
            return { name: device.name, ok: true, alreadyOff: true }
          }
          await this.#runAckedCommand(device, "power it off", controller => controller.powerOff())
          return { name: device.name, ok: true }
        } catch (/** @type {any} */ err) {
          return { name: device.name, ok: false, error: err.message }
        }
      }))
    }
    throw new DeviceManagerError('Power must be "on" or "off"', 400)
  }

  /**
   * Mutes every configured device. Unreachable devices are reported
   * individually instead of failing the batch.
   * @returns {Promise<Array<{name: string, ok: boolean, error?: string}>>}
   */
  async muteAllDevices() {
    return Promise.all(this.#devices.map(async device => {
      try {
        await this.#runAckedCommand(device, "mute it", controller => controller.muteOn())
        return { name: device.name, ok: true }
      } catch (/** @type {any} */ err) {
        return { name: device.name, ok: false, error: err.message }
      }
    }))
  }

  /**
   * Runs a boolean-acknowledged control command on a device's queue, turning
   * connection failures, timeouts and missing acknowledgements alike into a
   * 503 so the API layer sends a readable error to the UI.
   * @param {DeviceRecord} device
   * @param {string} problem what could not be done, phrased for the device ("power it off")
   * @param {(controller: NewLineDeviceController) => Promise<boolean>} operation
   * @returns {Promise<void>}
   */
  async #runAckedCommand(device, problem, operation) {
    try {
      const acknowledged = await this.#runQueued(device, operation)
      if (!acknowledged) {
        throw new Error("Device did not acknowledge the command")
      }
    } catch {
      throw new DeviceManagerError(`"${device.name}" is unreachable — could not ${problem}`, 503)
    }
  }

  /**
   * Captures the device's current live settings, persists them into config.json,
   * then applies them straight back to the device. Power state is deliberately
   * excluded: a saved config must never wake a monitor or switch one off.
   * @param {string} name
   * @returns {Promise<{name: string, settings: Object, applied: boolean, applyError?: string}>}
   */
  async saveDeviceConfig(name) {
    const device = this.#requireDevice(name)
    /** @type {Object} */
    let settings
    try {
      settings = await this.#captureSettings(device)
    } catch {
      throw new DeviceManagerError(
        `"${device.name}" is unreachable — could not read its current settings`,
        503
      )
    }

    device.raw.settings = settings
    device.settings = settings
    await this.#persistConfig()

    let applied = true
    /** @type {string | undefined} */
    let applyError
    try {
      await this.#applySettingsToDevice(device)
    } catch (/** @type {any} */ err) {
      applied = false
      applyError = err.message
    }

    return { name: device.name, settings, applied, ...(applyError ? { applyError } : {}) }
  }

  /**
   * Reads the current value of every configurable setting straight from the device.
   * @param {DeviceRecord} device
   * @returns {Promise<Object>}
   */
  async #captureSettings(device) {
    return this.#runQueued(device, async controller => {
      // Sequential on purpose: all commands share one socket with no request IDs.
      const mute = await controller.queryMute()
      const input = await controller.queryCurrentSignalSource()
      const volume = await controller.queryVolume()
      const displayMode = await controller.queryDisplayMode()
      const backlight = await controller.queryBacklightStatus()
      const backlightBrightness = await controller.queryBacklightBrightness()
      const sleep = await controller.querySleepModeStatus()

      if (typeof volume !== "number" || Number.isNaN(volume)) {
        throw new DeviceManagerError("Device returned an unreadable volume value", 502)
      }

      return {
        // Unknown sources (e.g. the launcher) have no restore command, so they are left out
        ...(input !== null ? { input } : {}),
        mute,
        displayMode,
        backlight,
        sleep,
        volume: Math.max(0, Math.min(MAX_LEVEL, volume)),
        backlightBrightness: Math.max(0, Math.min(MAX_LEVEL, Number(backlightBrightness) || 0))
      }
    })
  }

  /**
   * Pushes a device's recorded settings onto the hardware.
   * @param {DeviceRecord} device
   * @returns {Promise<void>}
   */
  async #applySettingsToDevice(device) {
    const settings = device.settings
    if (!settings) {
      return
    }

    return this.#runQueued(device, async controller => {
      /**
       * @param {string} label
       * @param {Promise<boolean>} action
       */
      const step = async (label, action) => {
        if (!(await action)) {
          throw new Error(`Device did not acknowledge "${label}"`)
        }
      }

      if (typeof settings.volume === "number") {
        await step("volume", controller.setVolume(settings.volume))
      }
      if (settings.mute === "muted") {
        await step("mute", controller.muteOn())
      } else if (settings.mute === "unmuted") {
        await step("mute", controller.muteOff())
      }

      if (settings.input === "hdmi1") {
        await step("input source", controller.hdmi1())
      } else if (settings.input === "hdmi2") {
        await step("input source", controller.hdmi2())
      } else if (settings.input === "hdmi3") {
        await step("input source", controller.hdmi3())
      }

      if (typeof settings.displayMode === "string") {
        await step("display mode", controller.setDisplayMode(DISPLAY_MODE_CODES[settings.displayMode] ?? 2))
      }

      if (settings.backlight === "on") {
        await step("backlight", controller.backlightOn())
      } else if (settings.backlight === "off") {
        await step("backlight", controller.backlightOff())
      }

      if (typeof settings.backlightBrightness === "number") {
        await this.#stepBrightness(controller, settings.backlightBrightness)
      }

      // Sleep goes last so it cannot stop the other commands from reaching the monitor
      if (settings.sleep === "on") {
        await step("sleep mode", controller.sleepOn())
      } else if (settings.sleep === "off") {
        await step("sleep mode", controller.sleepOff())
      }
    })
  }

  /**
   * The protocol only exposes relative brightness steps, so applying a saved
   * value means querying the current one and stepping up/down until they match.
   * @param {NewLineDeviceController} controller
   * @param {number} target
   * @returns {Promise<void>}
   */
  async #stepBrightness(controller, target) {
    const targetLevel = Math.max(0, Math.min(MAX_LEVEL, target))
    const current = await controller.queryBacklightBrightness()
    const difference = Math.trunc(targetLevel - Number(current))

    for (let remaining = Math.abs(difference); remaining > 0; remaining--) {
      const acknowledged = difference > 0
        ? await controller.increaseBrightness()
        : await controller.decreaseBrightness()
      if (!acknowledged) {
        throw new Error("Device did not acknowledge a brightness step")
      }
    }
  }

  /**
   * Applies every recorded device config. Devices without a saved config are
   * never contacted, and unreachable devices are reported individually instead
   * of failing the batch.
   * @returns {Promise<Array<{name: string, applied: boolean, settings: Object | null, error?: string}>>}
   */
  async applyAllSavedConfig() {
    const targets = this.#devices.filter(device => device.settings)
    return Promise.all(targets.map(async device => {
      try {
        await this.#applySettingsToDevice(device)
        return { name: device.name, applied: true, settings: device.settings }
      } catch (/** @type {any} */ err) {
        return { name: device.name, applied: false, settings: device.settings, error: err.message }
      }
    }))
  }

  /**
   * Validates and stores a new device in config.json.
   * @param {{ ip?: unknown, mac?: unknown, name?: unknown }} newDevice
   * @returns {Promise<{name: string, ip: string, mac: string}>}
   */
  async addDevice(newDevice) {
    const { errors, ip, mac, name } = this.#validateNewDevice(newDevice ?? {})
    if (Object.keys(errors).length > 0) {
      throw new DeviceManagerError("Device could not be added", 409, errors)
    }

    const entry = { ip, mac, name }
    this.#devices.push(this.#toRecord(entry))
    await this.#persistConfig()
    return { name, ip, mac }
  }

  /**
   * Field-level validation for the add-device form, including duplicate
   * checks against the existing config (MACs compare normalized,
   * names case-insensitively).
   * @param {{ ip?: unknown, mac?: unknown, name?: unknown }} newDevice
   * @returns {{ errors: Object<string, string>, ip: string, mac: string | null, name: string }}
   */
  #validateNewDevice(newDevice) {
    /** @type {Object<string, string>} */
    const errors = {}

    const ip = typeof newDevice.ip === "string" ? newDevice.ip.trim() : ""
    const rawMac = typeof newDevice.mac === "string" ? newDevice.mac.trim() : ""
    const name = typeof newDevice.name === "string" ? newDevice.name.trim() : ""

    if (ip === "") {
      errors.ip = "IP address is required"
    } else if (!IPV4_PATTERN.test(ip)) {
      errors.ip = `"${ip}" is not a valid IPv4 address`
    } else {
      const existing = this.#devices.find(device => device.ip === ip)
      if (existing) {
        errors.ip = `IP address is already in use by "${existing.name}"`
      }
    }

    /** @type {string | null} */
    const mac = rawMac === "" ? null : normalizeMac(rawMac)
    if (rawMac === "") {
      errors.mac = "MAC address is required"
    } else if (!mac) {
      errors.mac = `"${rawMac}" is not a valid MAC address`
    } else {
      const existing = this.#devices.find(device => normalizeMac(device.mac) === mac)
      if (existing) {
        errors.mac = `MAC address is already in use by "${existing.name}"`
      }
    }

    if (name === "") {
      errors.name = "Name is required"
    } else {
      const existing = this.#devices.find(device => device.name.toLowerCase() === name.toLowerCase())
      if (existing) {
        errors.name = `Name "${name}" is already in use`
      }
    }

    return { errors, ip, mac, name }
  }

  /**
   * Creates an empty config file so server startup always has a valid
   * config.json to read and later writes (adding devices, saved configs)
   * always succeed.
   */
  #createEmptyConfig() {
    writeFileSync(this.#configPath, JSON.stringify({ devices: [] }, null, 2) + "\n")
    log.info({ path: this.#configPath }, "Created empty config file")
  }

  /** Writes the current device list (including saved settings) back to config.json. */
  async #persistConfig() {
    const payload = { devices: this.#devices.map(device => device.raw) }
    await writeFile(this.#configPath, JSON.stringify(payload, null, 2) + "\n")
  }

  /**
   * Opens a throwaway connection to `ip` and issues a single power query to
   * check that a candidate device is reachable.
   * @param {string} ip
   * @returns {Promise<{online: boolean, power?: string}>}
   */
  async testConnection(ip) {
    if (typeof ip !== "string" || !IPV4_PATTERN.test(ip.trim())) {
      throw new DeviceManagerError("A valid IPv4 address is required to test a connection", 400)
    }

    let controller
    try {
      controller = new NewLineDeviceController({ ipAddress: ip.trim(), macAddress: "" })
      const power = await controller.queryPower()
      return { online: true, power }
    } catch {
      return { online: false }
    } finally {
      try {
        controller?.socket.destroy()
      } catch {
        // socket already gone
      }
    }
  }

  /**
   * Sends a Wake-on-LAN magic packet to a MAC address.
   * @param {string} mac
   * @returns {Promise<{success: boolean}>} resolves once the packet is handed
   * to the network; UDP delivery to the monitor itself cannot be confirmed.
   */
  async wakeDevice(mac) {
    const normalized = typeof mac === "string" ? normalizeMac(mac) : null
    if (!normalized) {
      throw new DeviceManagerError("A valid MAC address is required to wake a device", 400)
    }
    await this.#sendMagicPacket(normalized)
    return { success: true }
  }

  /**
   * Sends Wake-on-LAN to every configured device. Individual failures are
   * reported, never thrown.
   * @returns {Promise<Array<{name: string, mac: string, ok: boolean, error?: string}>>}
   */
  async wakeAllDevices() {
    return Promise.all(this.#devices.map(async device => {
      try {
        await this.#sendMagicPacket(device.mac)
        return { name: device.name, mac: device.mac, ok: true }
      } catch (/** @type {any} */ err) {
        return { name: device.name, mac: device.mac, ok: false, error: err.message }
      }
    }))
  }

  /**
   * @param {string} mac normalized MAC address
   * @returns {Promise<void>}
   */
  #sendMagicPacket(mac) {
    return new Promise((resolve, reject) => {
      wol.wake(mac, err => (err ? reject(err) : resolve()))
    })
  }
}

/**
 * Normalizes a MAC address to lowercase colon-separated hex pairs, either for
 * storage or for duplicate comparison. Returns null when the input is not a MAC.
 * @param {string} mac
 * @returns {string | null}
 */
function normalizeMac(mac) {
  const hex = mac.replace(/[:-]/g, "").toLowerCase()
  if (!/^[0-9a-f]{12}$/.test(hex)) {
    return null
  }
  return hex.match(/../g)?.join(":") ?? null
}