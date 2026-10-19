import { showToast, showToastForError, showToastForResponse } from "./toast.js"

const REFRESH_INTERVAL_S = 10
const INPUT_LABELS = {
  hdmi1: "HDMI 1",
  hdmi2: "HDMI 2",
  hdmi3: "HDMI 3"
}

const cardsElement = document.getElementById("device-cards")
const statusElement = document.getElementById("devices-status")
const reloadButton = document.getElementById("reload-config-btn")
const powerAllOnButton = document.getElementById("power-all-on-btn")
const powerAllOffButton = document.getElementById("power-all-off-btn")
const muteAllButton = document.getElementById("mute-all-btn")
const refreshButton = document.getElementById("refresh-btn")
const refreshIcon = document.getElementById("refresh-icon")
const refreshCountdownText = document.getElementById("refresh-countdown")

/** @type {boolean} */
let refreshInFlight = false
/** @type {number} */
let refreshCountdownS = REFRESH_INTERVAL_S

/**
 * Fetches card data and renders it. Driven by the countdown on the refresh
 * button and restartable anywhere (button click, after a control action).
 * Every run restarts the countdown from the full interval.
 */
function refresh() {
  refreshCountdownS = REFRESH_INTERVAL_S
  renderRefreshCountdown()
  if (refreshInFlight) {
    return
  }
  refreshInFlight = true
  refreshIcon.classList.add("fa-spin")
  refreshButton.disabled = true
  fetch("/api/devices")
    .then(async response => {
      if (!response.ok) {
        throw new Error(`Could not load devices (HTTP ${response.status})`)
      }
      const { devices } = await response.json()
      renderCards(devices)
    })
    .catch(err => {
      // Inline status line instead of a toast — this recurs every 10s
      setStatus(`Could not load devices: ${err.message}`)
    })
    .finally(() => {
      refreshInFlight = false
      refreshIcon.classList.remove("fa-spin")
      refreshButton.disabled = false
    })
}

setInterval(() => {
  // Ticks are skipped while a refresh is in flight; refresh() has already
  // reset the countdown, so it resumes from the full interval afterwards.
  if (refreshInFlight) {
    return
  }
  refreshCountdownS -= 1
  if (refreshCountdownS <= 0) {
    refresh()
  } else {
    renderRefreshCountdown()
  }
}, 1000)
refresh()

/**
 * Updates the seconds remaining shown next to the refresh icon.
 */
function renderRefreshCountdown() {
  refreshCountdownText.textContent = `${refreshCountdownS}s`
}

// Card buttons are wired by delegation because the cards are re-rendered
// wholesale on every refresh.
cardsElement.addEventListener("click", event => {
  if (!(event.target instanceof Element)) {
    return
  }
  const button = event.target.closest("button[data-action]")
  if (!(button instanceof HTMLButtonElement) || button.disabled) {
    return
  }
  if (button.dataset.action === "power") {
    toggleDevicePower(button)
  } else if (button.dataset.action === "mute") {
    toggleDeviceMute(button)
  }
})

powerAllOnButton.addEventListener("click", () => {
  runBulkAction(powerAllOnButton, "/api/devices/power-all", { power: "on" },
    sent => `Wake-up signal sent to ${sent} device${pluralS(sent)}.`)
})

powerAllOffButton.addEventListener("click", () => {
  runBulkAction(powerAllOffButton, "/api/devices/power-all", { power: "off" },
    (poweredOff, alreadyOff) => {
      const message = `Powered off ${poweredOff} device${pluralS(poweredOff)}.`
      return alreadyOff > 0 ? `${message} ${alreadyOff} already off.` : message
    })
})

muteAllButton.addEventListener("click", () => {
  runBulkAction(muteAllButton, "/api/devices/mute-all", {},
    muted => `Muted ${muted} device${pluralS(muted)}.`)
})

refreshButton.addEventListener("click", () => refresh())

reloadButton.addEventListener("click", async () => {
  setButtonBusy(reloadButton, true)
  try {
    const response = await fetch("/api/devices/reload", { method: "POST" })
    if (!response.ok) {
      await showToastForResponse(response)
      return
    }
    const { results } = await response.json()
    const applied = results.filter(result => result.applied)
    for (const result of results.filter(result => !result.applied)) {
      showToast(`Could not load saved config onto "${result.name}": ${result.error}`, "danger")
    }
    if (applied.length > 0) {
      showToast(`Saved config loaded onto ${applied.length} device${applied.length === 1 ? "" : "s"}.`, "success")
    } else if (results.length === 0) {
      showToast("No devices have a saved config yet.", "warning")
    }
    refresh()
  } catch (err) {
    showToastForError(err)
  } finally {
    setButtonBusy(reloadButton, false)
  }
})

/**
 * @param {Array<{name: string, ip: string, online: boolean, power: string | null, mute: string | null, input: string | null}>} devices
 */
function renderCards(devices) {
  cardsElement.replaceChildren()

  if (devices.length === 0) {
    setStatus("", "No devices configured yet — add one to get started.")
    return
  }
  setStatus(null)

  for (const device of devices) {
    cardsElement.append(createCard(device))
  }
}

/**
 * Builds a device card. The card is not a link anymore — it contains buttons —
 * so the device name links to the detail page instead. All dynamic values go
 * through textContent, never innerHTML, since names come from config.
 * @param {{name: string, ip: string, online: boolean, power: string | null, mute: string | null, input: string | null}} device
 * @returns {HTMLDivElement}
 */
function createCard(device) {
  const card = document.createElement("div")
  card.className = "card device-card"

  const body = document.createElement("div")
  body.className = "card-body"

  const title = document.createElement("h5")
  title.className = "card-title mb-2"
  const titleLink = document.createElement("a")
  titleLink.className = "text-decoration-none"
  titleLink.href = `/device/${encodeURIComponent(device.name)}`
  titleLink.textContent = device.name
  title.append(titleLink)

  const badges = document.createElement("div")
  badges.className = "d-flex flex-wrap gap-1 mb-3"
  if (!device.online) {
    badges.append(createBadge("Offline", "danger"))
  }
  badges.append(createBadge(`Power: ${device.power === "on" ? "On" : "Off"}`, device.power === "on" ? "success" : "secondary"))
  badges.append(createBadge(device.input ? INPUT_LABELS[device.input] ?? device.input : "No input", "info"))

  const ipAddress = document.createElement("p")
  ipAddress.className = "card-text mb-0 text-body-secondary"
  ipAddress.textContent = `IP: ${device.ip}`

  const actions = document.createElement("div")
  actions.className = "d-flex gap-2 mt-3"
  actions.append(createPowerButton(device), createMuteButton(device))

  body.append(title, badges, ipAddress, actions)
  card.append(body)
  return card
}

/**
 * Power toggle for one card: it always shows the action for the opposite of
 * the card's last-known state. Works for offline devices too, where the only
 * sensible action is a Wake-on-LAN "power on".
 * @param {{name: string, online: boolean, power: string | null}} device
 * @returns {HTMLButtonElement}
 */
function createPowerButton(device) {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "btn btn-sm btn-outline-secondary"
  button.dataset.action = "power"
  button.dataset.name = device.name
  button.dataset.power = device.power === "on" ? "on" : "off"
  renderControlButton(button)
  return button
}

/**
 * Mute toggle for one card. Disabled while the device is unreachable — its
 * mute state is unknown and no command could be delivered anyway.
 * @param {{name: string, online: boolean, mute: string | null}} device
 * @returns {HTMLButtonElement}
 */
function createMuteButton(device) {
  const muted = device.mute === "muted"
  const button = document.createElement("button")
  button.type = "button"
  button.className = `btn btn-sm ${muted ? "btn-danger" : "btn-outline-danger"}`
  button.dataset.action = "mute"
  button.dataset.name = device.name
  button.dataset.mute = muted ? "muted" : "unmuted"
  button.disabled = !device.online
  renderControlButton(button)
  return button
}

/**
 * Icon + label content for a card control button. The icon reflects the
 * device's current state (green power glyph when on, crossed speaker when
 * muted) while the label names the action the click will take. With `busy`
 * the state icon becomes a spinning loader instead.
 * @param {HTMLButtonElement} button
 * @param {boolean} [busy]
 */
function renderControlButton(button, busy = false) {
  const icon = document.createElement("i")
  icon.className = "fa-solid me-1"
  if (busy) {
    icon.classList.add("fa-spinner", "fa-spin")
  } else if (button.dataset.action === "power") {
    icon.classList.add("fa-power-off")
    if (button.dataset.power === "on") {
      icon.classList.add("text-success")
    }
  } else if (button.dataset.action === "mute") {
    icon.classList.add(button.dataset.mute === "muted" ? "fa-volume-xmark" : "fa-volume-high")
  }

  const label = button.dataset.action === "power"
    ? button.dataset.power === "on" ? "Power off" : "Power on"
    : button.dataset.mute === "muted" ? "Unmute" : "Mute"
  button.replaceChildren(icon, label)
}

/**
 * @param {string} text
 * @param {"danger" | "success" | "secondary" | "info"} color
 * @returns {HTMLSpanElement}
 */
function createBadge(text, color) {
  const badge = document.createElement("span")
  badge.className = `badge text-bg-${color}`
  badge.textContent = text
  return badge
}

/**
 * Sends the opposite of the card's last-known power state to the server.
 * @param {HTMLButtonElement} button
 */
function toggleDevicePower(button) {
  const name = button.dataset.name ?? ""
  const desired = button.dataset.power === "on" ? "off" : "on"
  sendDeviceControl(
    button,
    name,
    "power",
    desired,
    desired === "on" ? `Wake-up signal sent to "${name}".` : null
  )
}

/**
 * @param {HTMLButtonElement} button
 */
function toggleDeviceMute(button) {
  const name = button.dataset.name ?? ""
  const desired = button.dataset.mute === "muted" ? "unmuted" : "muted"
  sendDeviceControl(
    button,
    name,
    "mute",
    desired,
    `"${name}" ${desired === "muted" ? "muted" : "unmuted"}.`
  )
}

/**
 * POSTs one control request, shows feedback, then refreshes the cards so
 * buttons and badges reflect the device's actual state.
 * @param {HTMLButtonElement} button
 * @param {string} name
 * @param {"power" | "mute"} kind — both the URL segment and body field name
 * @param {string} value desired state ("on"/"off" or "muted"/"unmuted")
 * @param {string | null} successMessage
 */
async function sendDeviceControl(button, name, kind, value, successMessage) {
  setButtonBusy(button, true)
  try {
    const response = await fetch(`/api/devices/${encodeURIComponent(name)}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [kind]: value })
    })
    if (!response.ok) {
      await showToastForResponse(response)
      return
    }
    if (successMessage) {
      showToast(successMessage, "success")
    }
    refresh()
  } catch (err) {
    showToastForError(err)
  } finally {
    setButtonBusy(button, false)
  }
}

/**
 * Runs a bulk control endpoint and summarizes its per-device results as
 * toasts, then refreshes the cards.
 * @param {HTMLButtonElement} button
 * @param {string} path
 * @param {Object} body
 * @param {(succeeded: number, skipped: number) => string} describeSuccess
 */
async function runBulkAction(button, path, body, describeSuccess) {
  setButtonBusy(button, true)
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      await showToastForResponse(response)
      return
    }
    const { results } = await response.json()
    summarizeBulkResults(results, describeSuccess)
    refresh()
  } catch (err) {
    showToastForError(err)
  } finally {
    setButtonBusy(button, false)
  }
}

/**
 * Turns a bulk endpoint's per-device results into one or two summary toasts:
 * all-good on success, a warning listing unreachable devices otherwise.
 * @param {Array<{name: string, ok: boolean, alreadyOff?: boolean}>} results
 * @param {(succeeded: number, skipped: number) => string} describeSuccess
 */
function summarizeBulkResults(results, describeSuccess) {
  if (!Array.isArray(results) || results.length === 0) {
    showToast("No devices are configured yet.", "warning")
    return
  }
  const failed = results.filter(result => !result.ok)
  const skipped = results.filter(result => result.ok && result.alreadyOff).length
  const succeeded = results.length - failed.length - skipped
  const reached = succeeded + skipped
  const failedNames = failed.map(result => `"${result.name}"`).join(", ")

  if (failed.length === 0) {
    showToast(describeSuccess(succeeded, skipped), reached > 0 ? "success" : "warning")
  } else if (reached > 0) {
    showToast(`${describeSuccess(succeeded, skipped)} Could not reach: ${failedNames}.`, "warning")
  } else {
    showToast(`No device responded — could not reach: ${failedNames}.`, "danger")
  }
}

/**
 * @param {number} count
 */
function pluralS(count) {
  return count === 1 ? "" : "s"
}

/**
 * Shows or hides the status line under the cards.
 * @param {string | null} errorMessage null hides the line; an empty string keeps it hidden markup-wise
 * @param {string} [htmlContent] static, trusted HTML for the empty state
 */
function setStatus(errorMessage, htmlContent) {
  if (errorMessage === null) {
    statusElement.classList.add("d-none")
    statusElement.textContent = ""
    return
  }
  statusElement.classList.remove("d-none")
  if (errorMessage) {
    statusElement.textContent = errorMessage
  } else if (htmlContent) {
    statusElement.innerHTML = htmlContent
  }
}

/** Content of a button saved while it shows its busy placeholder */
/** @type {WeakMap<HTMLButtonElement, Node[]>} */
const savedButtonContent = new WeakMap()

/**
 * Busy state for any action button: disables it and swaps its content for a
 * spinning loader with a generic label. The original children are restored
 * afterwards, so buttons that contain icons — or labels rebuilt from card
 * data — survive every busy cycle intact.
 * @param {HTMLButtonElement} button
 * @param {boolean} busy
 */
function setButtonBusy(button, busy) {
  if (busy) {
    savedButtonContent.set(button, [...button.childNodes])
    const spinner = document.createElement("i")
    spinner.className = "fa-solid fa-spinner fa-spin me-1"
    spinner.setAttribute("aria-hidden", "true")
    button.replaceChildren(spinner, "Working…")
    button.disabled = true
  } else {
    const saved = savedButtonContent.get(button)
    if (saved) {
      button.replaceChildren(...saved)
      savedButtonContent.delete(button)
    }
    button.disabled = false
  }
}