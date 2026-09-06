import { MedicalFormData } from "./types";

export function buildPrompt(data: MedicalFormData): string {
  const lines: string[] = [
    `- First Name: ${data.firstName}`,
    `- Last Name: ${data.lastName}`,
    `- Date of Birth: ${data.dateOfBirth}`,
    `- Medical ID: ${data.medicalId}`,
  ];
  if (data.gender) lines.push(`- Gender: ${data.gender}`);
  if (data.bloodType) lines.push(`- Blood Type: ${data.bloodType}`);
  if (data.allergies) lines.push(`- Allergies: ${data.allergies}`);
  if (data.medications) lines.push(`- Current Medications: ${data.medications}`);
  if (data.emergencyContactName) lines.push(`- Emergency Contact Name: ${data.emergencyContactName}`);
  if (data.emergencyContactPhone) lines.push(`- Emergency Contact Phone: ${data.emergencyContactPhone}`);

  return `
You are filling out a "Medical Information Form" web page using the tools provided.

The form has 3 collapsible sections, only one open at a time (opening a new one collapses the
previous one, but values already entered are preserved):
1. Personal Information: First Name, Last Name, Date of Birth, Medical ID
2. Medical Information: Gender (dropdown), Blood Type (dropdown), Allergies, Current Medications
3. Emergency Contact: Emergency Contact Name, Emergency Contact Phone

"Personal Information" is OPEN by default when the page loads -- do not call openSection on it
unless you have observed (via a page state) that it is currently closed. openSection is a TOGGLE:
calling it on a section that is already open will close it again, losing your place. Every tool
result already includes the current page state, so you generally don't need to call getPageState
separately after an action -- only call it if you're starting fresh or genuinely unsure.

Fill in this data exactly:
${lines.join("\n")}

Process:
1. Call getPageState first to see what's currently visible.
2. Fill in every field belonging to the currently open section. Only call openSection when you
   need to reveal a section that is currently closed, then fill its fields.
3. Once every field listed above has been filled in, call submitForm.
4. submitForm's own result tells you whether it succeeded. Do NOT call any other tool after
   submitForm -- just reply immediately with a short final summary based on its result.
`.trim();
}
