import { z } from "zod";

// Single source of truth for the shape of the form data -- the TS type is derived from the zod
// schema (not hand-duplicated) so validation and typing can never drift apart.
export const medicalFormDataSchema = z.object({
  firstName: z.string().min(1, "firstName must not be empty"),
  lastName: z.string().min(1, "lastName must not be empty"),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateOfBirth must be in YYYY-MM-DD format"),
  medicalId: z.string().min(1, "medicalId must not be empty"),
  gender: z.string().optional(),
  bloodType: z.string().optional(),
  allergies: z.string().optional(),
  medications: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
});

export type MedicalFormData = z.infer<typeof medicalFormDataSchema>;

// Used to validate the POST /run request body: every field is optional (callers only override
// what they want), but anything present must be well-formed, and unrecognized fields are
// rejected outright rather than silently ignored.
export const partialMedicalFormDataSchema = medicalFormDataSchema.partial().strict();

export const exampleFormData: MedicalFormData = {
  firstName: "John",
  lastName: "Doe",
  dateOfBirth: "1990-01-01",
  medicalId: "91927885",
  gender: "Male",
  bloodType: "A+",
  allergies: "None",
  medications: "None",
  emergencyContactName: "Jane Doe",
  emergencyContactPhone: "555-0100",
};
