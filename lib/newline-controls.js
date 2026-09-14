// NOTE: for future: the response codes for controls are always the same as the input with a 0x01 byte before the ending byte
// There is one exception with the "switch backlight" command which has a 0 or 1 in that byte, because it has a true / false state

import net from "node:net"
import wol from "wake_on_lan"

/** Every control code and return code starts with these 8 bytes */
const CONTROL_CODE_PREFIX = [0x7F, 0x08, 0x99, 0xA2, 0xB3, 0xC4, 0x02, 0xFF]

/** Every control code and response ends with this byte */
const CONTROL_CODE_ENDING_BYTE = 0xCF;

export const QUERYING_CODES = {
}

const RESPONSE_BYTES = 12

export class NewLineDeviceController {

  /** @type {string} */
  macAddress = ""
  /** @type {net.Socket} */
  socket

  /**
   * @param {Object} params
   * @param {string} params.ipAddress
   * @param {string} params.macAddress
   */
  constructor(params) {
    this.macAddress = params.macAddress
    this.socket = new net.createConnection({
      host: params.ipAddress,
      port: 6688,
      keepAlive: true
    })
  }

  get ipAddress() {
    return this.socket.remoteAddress
  }

  powerOn() {
    return new Promise((resolve, reject) => {
      wol.wake(this.macAddress, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  powerOff() {
    return this.#simpleControl([0x01, 0x01])
  }

  sleepOn() {
    return this.#simpleControl([0x01, 0x04]);
  }

  sleepOff() {
    return this.#simpleControl([0x01, 0x03]);
  }

  muteToggle() {
    return this.#simpleControl([0x01, 0x02]);
  }

  // TODO: figure out meaning
  signalSource() {
    return this.#simpleControl([0x01, 0x06]);
  }

  displayStatus() {
    return this.#simpleControl([0x01, 0x09]);
  }

  hdmi1() {
    return this.#simpleControl([0x01, 0x0A]);
  }

  hdmi2() {
    return this.#simpleControl([0x01, 0x52]);
  }

  hdmi3() {
    return this.#simpleControl([0x01, 0x53]);
  }

  volumeDown() {
    return this.#simpleControl([0x01, 0x17]);
  }

  volumeUp() {
    return this.#simpleControl([0x01, 0x18]);
  }

  menu() {
    return this.#simpleControl([0x01, 0x1B]);
  }

  homePage() {
    return this.#simpleControl([0x01, 0x1C]);
  }

  exit() {
    return this.#simpleControl([0x01, 0x1D]);
  }

  ok() {
    return this.#simpleControl([0x01, 0x2B]);
  }

  left() {
    return this.#simpleControl([0x01, 0x2C]);
  }

  right() {
    return this.#simpleControl([0x01, 0x2D]);
  }

  up() {
    return this.#simpleControl([0x01, 0x2E]);
  }

  down() {
    return this.#simpleControl([0x01, 0x2F]);
  }

  increaseBrightness() {
    return this.#simpleControl([0x01, 0x47]);
  }

  decreaseBrightness() {
    return this.#simpleControl([0x01, 0x48]);
  }

  settings() {
    return this.#simpleControl([0x01, 0x20]);
  }

  muteOn() {
    return this.#simpleControl([0x0F, 0x00]);
  }

  muteOff() {
    return this.#simpleControl([0x0F, 0x01]);
  }

  backlightOn() {
    return this.#simpleControl([0x0E, 0x01]);
  }

  backlightOff() {
    return this.#simpleControl([0x0E, 0x00]);
  }

  activateNewlineCast() {
    return this.#simpleControl([0x00, 0x0D]);
  }

  closeNewlineCast() {
    return this.#simpleControl([0x01, 0x0D]);
  }

  activateNewlineBroadcast() {
    return this.#simpleControl([0x00, 0x0F]);
  }

  closeNewlineBroadcast() {
    return this.#simpleControl([0x01, 0x0F]);
  }

  /**
   * @param {number} volume
   */
  setVolume(volume) {
    // NOTE: takes hex representation of volume for second byte (0-100)
    return this.#simpleControl([0x05, volume])
  }

  /**
   * @param {0 | 1 | 2} mode
   */
  setDisplayMode(mode) {
    // NOTE: takes an input for the second command byte
    // 00 = backlight 100%, 01 = backlight 50%, 02 = custom?
    return this.#simpleControl([0x06, mode])
  }

  async backlightToggle() {
    // NOTE: has a special return code. Third controlled byte is 00 = off and 01 = on
    const code = [0x01, 0x15]
    const controlBuffer = Buffer.from([...CONTROL_CODE_PREFIX, ...code, CONTROL_CODE_ENDING_BYTE])
    const responseBuffer = await this.sendMessage(controlBuffer)

    const bytePos = CONTROL_CODE_PREFIX.length + code.length
    const result = responseBuffer[bytePos]

    if (result === 1) {
      return 'on'
    } else {
      return 'off'
    }
  }

  async queryPower() {
    const result = await this.#query([0x01, 0x37]);
    if (result == 0x01) {
      return 'on'
    }
    return 'off'
  }

  async queryMute() {
    const result = await this.#query([0x01, 0x82])
    if (result == 0x01) {
      return 'muted'
    }
    return 'unmuted'
  }

  async queryCurrentSignalSource() {
    const result = await this.#query([0x01, 0x50])
    if (result == 0x19) {
      return 'hdmi1'
    } else if (result == 0x1F) {
      return 'hdmi2'
    } else if (result == 0x1E) {
      return 'hdmi3'
    }
    return null
  }

  queryVolume() {
    return this.#query([0x01, 0x33])
  }

  async queryDisplayMode() {
    const result = await this.#query([0x01, 0x35])
    if (result == 0x00) {
      return 'standard'
    } else if (result == 0x01) {
      return 'eco'
    }
    return 'custom'
  }

  queryBacklightBrightness() {
    return this.#query([0x01, 0x49])
  }

  async queryBacklightStatus() {
    const result = await this.#query([0x01, 0x81])
    if (result == 0x00) {
      return 'on'
    }
    return 'off'
  }

  async querySleepModeStatus() {
    const result = await this.#query([0x01, 0x45])
    if (result == 0x01) {
      return 'on'
    }
    return 'off'
  }

  async restorePreviousOptions() {
    // TODO: maybe implement this? Not sure if needed
    // Complicates the logic a bit (because it dupes the logic from the other querying methods)
    const code = [0x0A, 0x00]
    const buffer = Buffer.from([...CONTROL_CODE_PREFIX, ...code, CONTROL_CODE_ENDING_BYTE])
    const _message = await this.sendMessage(buffer)
    return true
  }

  /**
   * @param {[number, number]} code
   */
  async #query(code) {
    const buffer = Buffer.from([...CONTROL_CODE_PREFIX, ...code, CONTROL_CODE_ENDING_BYTE])
    const message = await this.sendMessage(buffer)
    const bytePos = CONTROL_CODE_PREFIX.length + code.length

    return message[bytePos]
  }

  /**
   * This is used to do basic control codes where the response == the input with an extra byte
   * Most of the control codes fall into this category with the major exception of backlightToggle
   * @param {[number, number]} code
   */
  async #simpleControl(code) {
    const controlBuffer = Buffer.from([...CONTROL_CODE_PREFIX, ...code, CONTROL_CODE_ENDING_BYTE])
    const expectedResponse = Buffer.from([...CONTROL_CODE_PREFIX, ...code, 0x01, CONTROL_CODE_ENDING_BYTE])
    const responseBuffer = await this.sendMessage(controlBuffer)

    return expectedResponse.compare(responseBuffer) == 0
  }

  /**
   * @param {Buffer} buf
   * @returns {Promise<Buffer<number>>}
   */
  sendMessage(buf) {
    console.log('sending message...', buf)
    return new Promise((resolve, reject) => {
      let response = Buffer.alloc(0)

      const onData = chunk => {
        console.log('got data:', chunk)
        response = Buffer.concat([response, chunk])

        if (response.length < RESPONSE_BYTES) {
          return
        }

        const message = response.subarray(0, RESPONSE_BYTES)
        cleanup();
        resolve(message)
      }

      const onError = (err) => {
        cleanup()
        reject(err)
      }

      const onClose = () => {
        cleanup()
        reject(new Error("Socket closed"))
      }

      const cleanup = () => {
        this.socket
          .off('data', onData)
          .off('error', onError)
          .off('close', onClose)
      }
      this.socket
        .on('data', onData)
        .once('error', onError)
        .once('close', onClose)

      this.socket.write(buf)
    })
  }
}
