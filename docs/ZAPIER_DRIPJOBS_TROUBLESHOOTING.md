# Zapier → DripJobs: Data in Zapier but not in DripJobs

If you see the webhook payload in Zapier (Catch Hook) but the lead does not appear in DripJobs, check the following.

## 1. Zap has a DripJobs action step

- **Trigger:** Webhooks by Zapier → Catch Hook (you have this if you see the data).
- **Action:** You must add a second step that creates a lead in DripJobs.
  - In the Zap editor, click **+** to add a step.
  - Choose **DripJobs** (or your CRM app) → action like **Create Lead** / **Create Job** / **Add Lead**.
  - Connect your DripJobs account if prompted.
  - Map the webhook fields to DripJobs fields (e.g. First Name ← `first_name`, Last Name ← `last_name`, Email ← `contact_email`, Phone ← `contact_phone`, Address ← `address`).

Without this action step, Zapier only receives the data and does not send it to DripJobs.

## 2. Zap is turned ON

- In Zapier, the Zap must be **On** (toggle in the top right of the Zap editor).
- If it’s only in draft, the trigger will receive data but the action will not run for new catches.

## 3. Filter (if you use one) is passing

- If you added a **Filter** step so the Zap runs only when `event_type` = `booking`:
  - Trigger data field: choose the field that contains the event type (e.g. `event_type` from the webhook payload).
  - Condition: **(value)** **equals** **booking** (exact, case-sensitive).
- If the filter fails, the Zap stops and the DripJobs step never runs. Check the Zap’s **Task History** for that run and see if the filter step passed or failed.

## 4. Field mapping in the DripJobs step

- In the DripJobs action step, every required field (e.g. First Name, Email) must be mapped.
- Map from the **Catch Hook** step, e.g.:
  - First Name → `first_name`
  - Last Name → `last_name`
  - Email → `contact_email`
  - Phone → `contact_phone`
  - Address → `address` (or combine `address` + `city` if DripJobs has one address field)
  - Notes / Description → `notes`
- If a required field in DripJobs is empty or invalid, the action can fail silently or show an error in Task History.

## 5. Test the DripJobs step in Zapier

- In the Zap editor, run **Test step** on the DripJobs action.
- If it fails, Zapier will show the error (e.g. “Invalid email”, “Required field missing”, or DripJobs API error). Fix the mapping or DripJobs settings accordingly.
- Use **Task History** (Zapier dashboard) to see whether recent runs succeeded or failed at the trigger, filter, or action step.

## 6. Where to look in DripJobs

- Leads might be under a different list, pipeline, or “Leads” / “Jobs” view.
- Check DripJobs filters (e.g. date range, status) so the new test lead is not hidden.
- Confirm you’re logged into the correct DripJobs account/workspace that is connected to Zapier.

## Quick checklist

- [ ] Zap has **2+ steps**: Webhook (trigger) + DripJobs (action).
- [ ] Zap is **On**.
- [ ] If you use a Filter, it checks `event_type` **equals** `booking` and the test run **passed** the filter.
- [ ] DripJobs step has required fields mapped from the webhook (e.g. `first_name`, `contact_email`).
- [ ] **Test step** on the DripJobs action succeeds.
- [ ] **Task History** shows a successful run for your test (no errors on the DripJobs step).
- [ ] You’re looking in the right place in DripJobs (correct list/view and account).

## Payload your app sends (for mapping reference)

When `event_type` = `booking`, the webhook body includes:

- `event_type`, `source`, `tenant_id`, `tenant_name`, `company_name`
- `first_name`, `last_name`, `contact_name`
- `contact_phone`, `contact_email`
- `address`, `city`, `scope`, `job_type`, `preferred_date`, `notes`
- `booking_id`

In Zapier, when mapping the DripJobs action, use the fields from the **Catch Hook** trigger (they will appear under the trigger step name, often as 1. event_type, 2. first_name, etc.).
