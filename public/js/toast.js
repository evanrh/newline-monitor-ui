// Shared toast notifications for reporting errors and success feedback.
// Depends on the Bootstrap bundle, which every page loads before these modules run.

const CONTAINER_CLASS = "toast-container position-fixed bottom-0 end-0 p-3"

/**
 * @param {string} message
 * @param {"danger" | "success" | "warning" | "primary"} [type]
 * @param {number} [delayMs]
 */
export function showToast(message, type = "danger", delayMs = 5000) {
  const container = ensureContainer()

  const toast = document.createElement("div")
  toast.className = `toast align-items-center text-bg-${type} border-0`
  toast.setAttribute("role", "alert")
  toast.setAttribute("aria-live", "assertive")
  toast.setAttribute("aria-atomic", "true")

  const layout = document.createElement("div")
  layout.className = "d-flex"

  const body = document.createElement("div")
  body.className = "toast-body"
  body.textContent = message

  const closeButton = document.createElement("button")
  closeButton.type = "button"
  closeButton.className = "btn-close btn-close-white me-2 m-auto"
  closeButton.setAttribute("data-bs-dismiss", "toast")
  closeButton.setAttribute("aria-label", "Close")

  layout.append(body, closeButton)
  toast.append(layout)
  container.append(toast)

  window.bootstrap.Toast.getOrCreateInstance(toast, { delay: delayMs }).show()
}

/**
 * Shows an error toast for a failed fetch response, preferring the error
 * message the server sent in its JSON body.
 * @param {Response} response
 */
export async function showToastForResponse(response) {
  let message = `Request failed (HTTP ${response.status})`
  try {
    const data = await response.json()
    if (typeof data?.error === "string") {
      message = data.error
    }
  } catch {
    // Non-JSON error body — keep the generic message
  }
  showToast(message, "danger")
}

/**
 * @param {unknown} error
 */
export function showToastForError(error) {
  showToast(error instanceof Error ? error.message : String(error), "danger")
}

function ensureContainer() {
  const existing = document.querySelector(".toast-container")
  if (existing) {
    return existing
  }
  const container = document.createElement("div")
  container.className = CONTAINER_CLASS
  document.body.append(container)
  return container
}