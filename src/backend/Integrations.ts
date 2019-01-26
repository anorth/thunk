import GDrive from "../integrations/gdrive";

// Integration is currently hardcoded to Google Drive. Goal is to support multiple in parallel.
export const INTEGRATION_SINGLETON = new GDrive();
