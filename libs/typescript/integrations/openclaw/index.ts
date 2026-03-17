import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createMLflowService } from "./src/service.js";

const plugin = {
  id: "mlflow-openclaw",
  name: "MLflow Tracing",
  description: "Export OpenClaw LLM traces to MLflow",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerService(createMLflowService(api));
  },
};

export default plugin;
