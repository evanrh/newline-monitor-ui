// NOTE: for future: the response codes for controls are always the same as the input with a 0x01 byte before the ending byte
// There is one exception with the "switch backlight" command which has a 0 or 1 in that byte, because it has a true / false state

/** Every control code and return code starts with these 8 bytes */
const CONTROL_CODE_PREFIX = [0x7F, 0x08, 0x99, 0xA2, 0xB3, 0xC4, 0x02, 0xFF]

/** Every control code and response ends with this byte */
const CONTROL_CODE_ENDING_BYTE = 0xCF;

/** Map of tuples of control codes to their corresponding responses
* Several can take a variable value in their code (e.g volume and brightness)
* These will be marked with a comment denoting that they accept input
*/
const CONTROL_CODES = {
  // powerOn: 'NOT IMPLEMENTED -- DOES NOT WORK OVER TCP/IP',
  powerOff: [...CONTROL_CODE_PREFIX, 0x01, 0x01, CONTROL_CODE_ENDING_BYTE],
  sleepOn: [...CONTROL_CODE_PREFIX, 0x01, 0x04, CONTROL_CODE_ENDING_BYTE],
  sleepOff: [...CONTROL_CODE_PREFIX, 0x01, 0x03, CONTROL_CODE_ENDING_BYTE],
  muteToggle: [...CONTROL_CODE_PREFIX, 0x01, 0x02, CONTROL_CODE_ENDING_BYTE],

  // TODO: figure out meaning
  signalSource: [...CONTROL_CODE_PREFIX, 0x01, 0x06, CONTROL_CODE_ENDING_BYTE],
  displayStatus: [...CONTROL_CODE_PREFIX, 0x01, 0x09, CONTROL_CODE_ENDING_BYTE],
  hdmi1: [...CONTROL_CODE_PREFIX, 0x01, 0x0A, CONTROL_CODE_ENDING_BYTE],
  hdmi2: [...CONTROL_CODE_PREFIX, 0x01, 0x52, CONTROL_CODE_ENDING_BYTE],
  hdmi3: [...CONTROL_CODE_PREFIX, 0x01, 0x53, CONTROL_CODE_ENDING_BYTE],
  volumeDown: [...CONTROL_CODE_PREFIX, 0x01, 0x17, CONTROL_CODE_ENDING_BYTE],
  volumeUp: [...CONTROL_CODE_PREFIX, 0x01, 0x18, CONTROL_CODE_ENDING_BYTE],
  menu: [...CONTROL_CODE_PREFIX, 0x01, 0x1B, CONTROL_CODE_ENDING_BYTE],
  homePage: [...CONTROL_CODE_PREFIX, 0x01, 0x1C, CONTROL_CODE_ENDING_BYTE],
  exit: [...CONTROL_CODE_PREFIX, 0x01, 0x1D, CONTROL_CODE_ENDING_BYTE],
  ok: [...CONTROL_CODE_PREFIX, 0x01, 0x2B, CONTROL_CODE_ENDING_BYTE],
  left: [...CONTROL_CODE_PREFIX, 0x01, 0x2C, CONTROL_CODE_ENDING_BYTE],
  right: [...CONTROL_CODE_PREFIX, 0x01, 0x2D, CONTROL_CODE_ENDING_BYTE],
  up: [...CONTROL_CODE_PREFIX, 0x01, 0x2E, CONTROL_CODE_ENDING_BYTE],
  down: [...CONTROL_CODE_PREFIX, 0x01, 0x2F, CONTROL_CODE_ENDING_BYTE],

  // NOTE: takes hex representation of volume for second byte (0-100)
  setVolume: [...CONTROL_CODE_PREFIX, 0x05, 0x00, CONTROL_CODE_ENDING_BYTE],

  // NOTE: takes an input for the second command byte
  // 00 = backlight 100%, 01 = backlight 50%, 02 = custom?
  setDisplayMode: [...CONTROL_CODE_PREFIX, 0x06, 0x00, CONTROL_CODE_ENDING_BYTE],

  increaseBrightness: [...CONTROL_CODE_PREFIX, 0x01, 0x47, CONTROL_CODE_ENDING_BYTE],
  decreaseBrightness: [...CONTROL_CODE_PREFIX, 0x01, 0x48, CONTROL_CODE_ENDING_BYTE],

  // NOTE: has a special return code. Third controlled byte is 00 = off and 01 = on
  backlightToggle: [...CONTROL_CODE_PREFIX, 0x01, 0x15, CONTROL_CODE_ENDING_BYTE],

  settings: [...CONTROL_CODE_PREFIX, 0x01, 0x20, CONTROL_CODE_ENDING_BYTE],
  muteOn: [...CONTROL_CODE_PREFIX, 0x0F, 0x00, CONTROL_CODE_ENDING_BYTE],
  muteOff: [...CONTROL_CODE_PREFIX, 0x0F, 0x01, CONTROL_CODE_ENDING_BYTE],
  backlightOn: [...CONTROL_CODE_PREFIX, 0x0E, 0x01, CONTROL_CODE_ENDING_BYTE],
  backlightOff: [...CONTROL_CODE_PREFIX, 0x0E, 0x00, CONTROL_CODE_ENDING_BYTE],
  activateNewlineCast: [...CONTROL_CODE_PREFIX, 0x00, 0x0D, CONTROL_CODE_ENDING_BYTE],
  closeNewlineCast: [...CONTROL_CODE_PREFIX, 0x01, 0x0D, CONTROL_CODE_ENDING_BYTE],
  activateNewlineBroadcast: [...CONTROL_CODE_PREFIX, 0x00, 0x0F, CONTROL_CODE_ENDING_BYTE],
  closeNewlineBroadcast: [...CONTROL_CODE_PREFIX, 0x01, 0x0F, CONTROL_CODE_ENDING_BYTE],
}

export const QUERYING_CODES = {
  powerSupply: [...CONTROL_CODE_PREFIX, 0x01, 0x37, CONTROL_CODE_ENDING_BYTE],
  speaker: [...CONTROL_CODE_PREFIX, 0x01, 0x82, CONTROL_CODE_ENDING_BYTE],
  currentSignalSource: [...CONTROL_CODE_PREFIX, 0x01, 0x50, CONTROL_CODE_ENDING_BYTE],
  speakerVolume: [...CONTROL_CODE_PREFIX, 0x01, 0x33, CONTROL_CODE_ENDING_BYTE],
  displayMode: [...CONTROL_CODE_PREFIX, 0x01, 0x35, CONTROL_CODE_ENDING_BYTE],
  backlightBrightness: [...CONTROL_CODE_PREFIX, 0x01, 0x49, CONTROL_CODE_ENDING_BYTE],
  backlightStatus: [...CONTROL_CODE_PREFIX, 0x01, 0x81, CONTROL_CODE_ENDING_BYTE],
  sleepModeStatus: [...CONTROL_CODE_PREFIX, 0x01, 0x45, CONTROL_CODE_ENDING_BYTE],
  returnToPreviousOptions: [...CONTROL_CODE_PREFIX, 0x0A, 0x00, CONTROL_CODE_ENDING_BYTE],
}

/**
* @param {keyof typeof CONTROL_CODES & keyof typeof QUERYING_CODES} key
* @param {'query' | 'control'} type
* @param {number=} input
*/
export function getCode(key, type, input) {
  if (type === 'query') {
    return getQueryingCode(key)
  } else {
    return getControlCode(key, input)
  }
}

/**
* @param {keyof typeof QUERYING_CODES} key
*/
function getQueryingCode(key) {
  return Buffer.from(QUERYING_CODES[key])
}

/**
* @param {keyof typeof CONTROL_CODES} key
* @param {number=} input
*/
function getControlCode(key, input) {
  if (key === 'setVolume') {
    // Do volume things
  }
  return Buffer.from(CONTROL_CODES[key])
}
