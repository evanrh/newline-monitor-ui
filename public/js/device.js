import { showToast, showToastForError, showToastForResponse } from "./toast.js"

const mainElement = document.querySelector("main")
const deviceName = mainElement?.dataset.deviceName ?? ""

const onlineBadge = document.getElementById("online-badge")
const offlineAlert = document.getElementById("offline-alert")
const detailBody = document.getElementById("detail-tbody")
const saveButton = document.getElementById("save-config-btn")
const savedConfigNote = document.getElementById("saved-config-note")

const INPUT_LABELS = {
  hdmi1: "HDMI 1",
  hdmi2: "HDMI 2",
  hdmi3: "HDMI 3"
}

/**
 * Every queryable data point, rendered in order. Values fall back to an
 * em-dash when the device is unreachable.
 * @type {Array<{label: string, value: (data: any) => string}>}
 */
const DATA_ROWS = [
  { label: "Power", value: data => formatOnOff(data.power) },
  { label: "Mute", value: data => data.mute === "muted" ? "Muted" : data.mute === "unmuted" ? "Unmuted" : "—" },
  { label: "Input source", value: data => data.input ? INPUT_LABELS[data.input] ?? data.input : "—" },
  { label: "Volume", value: data => typeof data.volume === "number" ? String(data.volume) : "—" },
  { label: "Display mode", value: data => capitalize(data.displayMode) },
  { label: "Backlight", value: data => formatOnOff(data.backlight) },
  { label: "Backlight brightness", value: data => typeof data.backlightBrightness === "number" ? String(data.backlightBrightness) : "—" },
  { label: "Sleep mode", value: data => formatOnOff(data.sleep) }
]

loadDevice()

saveButton.addEventListener("click", async () => {
  setButtonBusy(saveButton, true)
  try {
    const response = await fetch(`/api/devices/${encodeURIComponent(deviceName)}/config`, { method: "POST" })
    if (!response.ok) {
      await showToastForResponse(response)
      return
    }
    const result = await response.json()
    if (result.applied) {
      showToast("Saved the device's current settings as its config, and applied them.", "success")
    } else {
      showToast(`Config saved, but applying it failed: ${result.applyError}`, "warning")
    }
    renderSavedConfigNote(result.settings)
  } catch (err) {
    showToastForError(err)
  } finally {
    setButtonBusy(saveButton, false)
  }
})

async function loadDevice() {
  try {
    const response = await fetch(`/api/devices/${encodeURIComponent(deviceName)}`)
    if (!response.ok) {
      await showToastForResponse(response)
      renderOfflineState()
      return
    }
    renderDetail(await response.json())
  } catch (err) {
    showToastForError(err)
    renderOfflineState()
  }
}

/**
 * @param {{online: boolean, ip: string, savedSettings: Object | null, [key: string]: any}} data
 */
function renderDetail(data) {
  if (data.online) {
    onlineBadge.className = "badge text-bg-success"
    onlineBadge.textContent = "Online"
    offlineAlert.classList.add("d-none")
    saveButton.disabled = false
  } else {
    renderOfflineState(data.ip)
    return
  }
  onlineBadge.hidden = false

  detailBody.replaceChildren()
  for (const row of DATA_ROWS) {
    const labelCell = document.createElement("th")
    labelCell.scope = "row"
    labelCell.textContent = row.label

    const valueCell = document.createElement("td")
    valueCell.textContent = row.value(data)

    const rowElement = document.createElement("tr")
    rowElement.append(labelCell, valueCell)
    detailBody.append(rowElement)
  }

  renderSavedConfigNote(data.savedSettings)
}

/**
 * Shows the unreachable state; called both for offline responses and
 * failed fetches.
 * @param {string} [ip]
 */
function renderOfflineState(ip) {
  onlineBadge.className = "badge text-bg-danger"
  onlineBadge.textContent = "Offline"
  onlineBadge.hidden = false
  offlineAlert.classList.remove("d-none")
  saveButton.disabled = true

  detailBody.replaceChildren()
  if (ip) {
    const ipRow = document.createElement("tr")
    const labelCell = document.createElement("th")
    labelCell.scope = "row"
    labelCell.textContent = "IP address"
    const valueCell = document.createElement("td")
    valueCell.textContent = ip
    ipRow.append(labelCell, valueCell)
    detailBody.append(ipRow)
  }
}

/**
 * @param {Object | null} settings
 */
function renderSavedConfigNote(settings) {
  const settingsCount = settings ? Object.keys(settings).length : 0
  if (settingsCount === 0) {
    savedConfigNote.textContent = "This device has no saved config yet — use the button above to record its current state."
  } else {
    savedConfigNote.textContent = `A saved config with ${settingsCount} settings exists for this device and is applied when the server starts.`
  }
}

/**
 * @param {string | null | undefined} value
 */
function formatOnOff(value) {
  return capitalize(value)
}

/**
 * @param {string | null | undefined} value
 */
function capitalize(value) {
  return typeof value === "string" && value.length > 0
    ? value[0].toUpperCase() + value.slice(1)
    : "—"
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