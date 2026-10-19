import { showToast, showToastForError, showToastForResponse } from "./toast.js"

const REFRESH_INTERVAL_MS = 10000
const INPUT_LABELS = {
  hdmi1: "HDMI 1",
  hdmi2: "HDMI 2",
  hdmi3: "HDMI 3"
}

const cardsElement = document.getElementById("device-cards")
const statusElement = document.getElementById("devices-status")
const reloadButton = document.getElementById("reload-config-btn")

/** @type {boolean} */
let refreshInFlight = false

function refresh() {
  if (refreshInFlight) {
    return
  }
  refreshInFlight = true
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
    })
}

setInterval(refresh, REFRESH_INTERVAL_MS)
refresh()

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
 * @param {Array<{name: string, ip: string, online: boolean, power: string | null, input: string | null}>} devices
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
 * Builds a clickable device card. All dynamic values go through textContent,
 * never innerHTML, since names come from config.
 * @param {{name: string, ip: string, online: boolean, power: string | null, input: string | null}} device
 * @returns {HTMLAnchorElement}
 */
function createCard(device) {
  const card = document.createElement("a")
  card.className = "card device-card text-decoration-none"
  card.href = `/device/${encodeURIComponent(device.name)}`

  const body = document.createElement("div")
  body.className = "card-body"

  const title = document.createElement("h5")
  title.className = "card-title mb-2"
  title.textContent = device.name

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

  body.append(title, badges, ipAddress)
  card.append(body)
  return card
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

function setButtonBusy(button, busy) {
  if (busy) {
    button.dataset.label = button.textContent
    button.textContent = "Working…"
    button.disabled = true
  } else {
    button.textContent = button.dataset.label ?? button.textContent
    button.disabled = false
    delete button.dataset.label
  }
}