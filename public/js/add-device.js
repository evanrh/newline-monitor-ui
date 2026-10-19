import { showToast, showToastForError, showToastForResponse } from "./toast.js"

const IPV4_PATTERN = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const MAC_PATTERN = /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$|^[0-9A-F]{12}$/i

const ipInput = document.getElementById("device-ip")
const macInput = document.getElementById("device-mac")
const nameInput = document.getElementById("device-name")
const testConnectionButton = document.getElementById("test-connection-btn")
const wakeDeviceButton = document.getElementById("wake-device-btn")
const saveDeviceButton = document.getElementById("save-device-btn")

testConnectionButton.addEventListener("click", () => {
  const { ip } = readFields()
  if (!IPV4_PATTERN.test(ip)) {
    showToast("Enter a valid IPv4 address to test a connection.", "warning")
    ipInput.focus()
    return
  }

  runWithBusy(testConnectionButton, async () => {
    const response = await fetch("/api/devices/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip })
    })
    if (!response.ok) {
      await showToastForResponse(response)
      return
    }
    const result = await response.json()
    if (result.online) {
      showToast(`Device responded (power: ${result.power}).`, "success")
    } else {
      showToast("No response from the device — check the IP address and try again.", "danger")
    }
  })
})

wakeDeviceButton.addEventListener("click", () => {
  const { mac } = readFields()
  if (!MAC_PATTERN.test(mac)) {
    showToast("Enter a valid MAC address (e.g. AA:BB:CC:DD:EE:FF) to wake the device.", "warning")
    macInput.focus()
    return
  }

  runWithBusy(wakeDeviceButton, async () => {
    const response = await fetch("/api/devices/wake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mac })
    })
    if (!response.ok) {
      await showToastForResponse(response)
      return
    }
    showToast("Wake-on-LAN packet sent — the monitor may take a few seconds to come up.", "success")
  })
})

saveDeviceButton.addEventListener("click", () => {
  const { ip, mac, name } = readFields()

  /** @type {string[]} */
  const problems = []
  if (!IPV4_PATTERN.test(ip)) problems.push("Enter a valid IPv4 address.")
  if (!MAC_PATTERN.test(mac)) problems.push("Enter a valid MAC address.")
  if (name === "") problems.push("Enter a name for the device.")
  if (problems.length > 0) {
    for (const problem of problems) {
      showToast(problem, "warning")
    }
    return
  }

  runWithBusy(saveDeviceButton, async () => {
    const response = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, mac, name })
    })
    if (!response.ok) {
      // Duplicate / validation errors arrive as { error, fields } — toast each field
      const data = await response.json().catch(() => null)
      if (data?.fields && typeof data.fields === "object") {
        for (const message of Object.values(data.fields)) {
          showToast(String(message), "danger")
        }
      } else {
        await showToastForResponse(response)
      }
      return
    }
    showToast("Device added.", "success")
    setTimeout(() => {
      window.location.href = "/"
    }, 1200)
  })
})

/**
 * @returns {{ip: string, mac: string, name: string}}
 */
function readFields() {
  return {
    ip: ipInput.value.trim(),
    mac: macInput.value.trim(),
    name: nameInput.value.trim()
  }
}

/**
 * Disables a button while its async work runs.
 * @param {HTMLButtonElement} button
 * @param {() => Promise<void>} action
 */
function runWithBusy(button, action) {
  setButtonBusy(button, true)
  action().catch(err => showToastForError(err)).finally(() => setButtonBusy(button, false))
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