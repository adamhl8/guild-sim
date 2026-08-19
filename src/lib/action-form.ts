import { ACTION_QUERY_PARAMS, actions, isInputError } from "astro:actions"

/** Carries a success message across the reload that follows it, since the page it was meant for is replaced. */
const FLASH_KEY = "guild-sim:flash"

/** Every action returns a message, so the shared handler has exactly one thing to show. */
type FormAction = (
  data: FormData,
) => Promise<{ data: { message: string } | undefined; error: { message: string } | undefined }>

// `actions` is a Proxy that mints a callable for any key, so a string index is how it is meant to be addressed.
// A hand-kept registry of the five names would type-check, but forgetting a sixth would silently drop that
// form back to a native post -- the bug this file exists to prevent.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the Proxy answers to any key
const byName = actions as unknown as Record<string, FormAction | undefined>

const alertBox = (): HTMLElement | null => document.querySelector<HTMLElement>("#alert")

const showAlert = (kind: "success" | "error", message: string): void => {
  const box = alertBox()
  if (!box) return

  const text = box.querySelector("span")
  if (text) text.textContent = message
  box.classList.toggle("alert-success", kind === "success")
  box.classList.toggle("alert-error", kind === "error")
  box.classList.remove("hidden")
  // The settings form's button sits well below the fold, where an alert pinned to the top would go unseen.
  box.scrollIntoView({ block: "nearest" })
}

/**
 * A failed schema check carries no message of its own: Astro synthesises one by dumping the raw zod issues as JSON,
 * which is not something to put in front of a raider. The field names are.
 */
const messageOf = (error: { message: string }): string => {
  if (!isInputError(error)) return error.message
  const fields = Object.entries(error.fields).map(([field, issues]) => `${field}: ${(issues ?? []).join(", ")}`)
  return fields.length > 0 ? fields.join("; ") : error.message
}

const submitButtons = (form: HTMLFormElement): HTMLButtonElement[] => [
  ...form.querySelectorAll<HTMLButtonElement>("button[type=submit]"),
]

const run = async (action: FormAction, form: HTMLFormElement, submitter: HTMLElement | null): Promise<void> => {
  const buttons = submitButtons(form)
  for (const button of buttons) button.disabled = true
  alertBox()?.classList.add("hidden")

  // Without the submitter the clicked button's name and value are dropped, which is the whole payload for a
  // form whose buttons carry the choice -- the roster's rerun cells.
  const { data, error } = await action(new FormData(form, submitter))

  if (error) {
    // Nothing navigates, so a rejected paste is still sitting in the textarea. This is the whole point.
    showAlert("error", messageOf(error))
    for (const button of buttons) button.disabled = false
    return
  }

  if (data) sessionStorage.setItem(FLASH_KEY, data.message)
  // A GET, so the page reflects the change and a refresh cannot replay the post. Bare `pathname` also drops
  // any `_action` a native post left in the URL.
  location.assign(location.pathname)
}

const actionOf = (form: HTMLFormElement): FormAction | undefined => {
  const name = new URLSearchParams(form.getAttribute("action") ?? "").get(ACTION_QUERY_PARAMS.actionName)
  return name === null ? undefined : byName[name]
}

/** Intercepts every action form on the page so that submitting never puts a POST in history. */
export const bindActionForms = (): void => {
  const flash = sessionStorage.getItem(FLASH_KEY)
  if (flash !== null) {
    sessionStorage.removeItem(FLASH_KEY)
    showAlert("success", flash)
  }

  for (const form of document.querySelectorAll<HTMLFormElement>("form[data-action-form]")) {
    const action = actionOf(form)
    // Leaving an unrecognised form unbound falls back to the native post rather than a dead button.
    if (!action) continue

    form.addEventListener("submit", (event) => {
      event.preventDefault()
      void run(action, form, event.submitter)
    })
  }
}
