// Bundled only by offline Playwright; never imported by the application.
import { ProgressStore } from "../src/progression/progress-store";
import { deriveChallenge, startAttempt, conclusionAnswers } from "../src/progression/rules";
(globalThis as any).__progressHarness = { ProgressStore, deriveChallenge, startAttempt, conclusionAnswers };
