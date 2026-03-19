import type { Config } from "../config.js";
import type { ModelProfile } from "../types.js";

export class ModelProfileRegistry {
  private profiles = new Map<string, ModelProfile>();

  constructor(config: Config) {
    const defaultBaseUrl = config.apiBaseUrl ?? "https://api.anthropic.com";
    this.profiles.set("default", {
      name: "default",
      model: config.defaultModel,
      baseUrl: defaultBaseUrl,
      apiKey: config.apiKey,
    });
  }

  resolve(nameOrModel: string): ModelProfile {
    const byName = this.profiles.get(nameOrModel);
    if (byName) return byName;

    for (const profile of this.profiles.values()) {
      if (profile.model === nameOrModel) return profile;
    }

    return this.getDefault();
  }

  getDefault(): ModelProfile {
    const defaultProfile = this.profiles.get("default");
    if (!defaultProfile) {
      throw new Error("No model profiles configured");
    }
    return defaultProfile;
  }

  list(): ModelProfile[] {
    return [...this.profiles.values()];
  }
}
