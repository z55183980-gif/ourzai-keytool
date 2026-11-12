import type { ApplyRequest, ApplyResult, Environment, LaunchMode, LaunchRequest, ToolId } from "./types";

interface Dependencies {
  validateLaunch: (req: LaunchRequest) => Promise<void>;
  scanEnvironment: (baseUrl: string) => Promise<Environment>;
  applyConfig: (req: ApplyRequest) => Promise<ApplyResult>;
  revertToOfficial: (codex: boolean, claude: boolean) => Promise<string>;
  launchClient: (req: LaunchRequest) => Promise<{ message: string }>;
}

/**
 * Validate installation/directory before touching configuration; never launch after a failed write.
 * Desktop and CLI share the same user-level configuration, so both go through the same write path.
 * The one exception: desktop + "current" just opens the app without inspecting anything.
 */
export async function launchWithConfiguration(
  tool: ToolId, mode: LaunchMode, service: string, directory: string,
  applyRequest: ApplyRequest,
  dependencies: Dependencies,
  onConfigured: (result: ApplyResult) => void,
): Promise<{ message: string }> {
  const req: LaunchRequest = { target: `${tool}-${mode}`, directory };
  await dependencies.validateLaunch(req);
  if (mode === "desktop" && service === "current") return dependencies.launchClient(req);

  const env = await dependencies.scanEnvironment(applyRequest.baseUrl);
  const current = env[tool];
  if (current.configurationStatus === "broken") throw new Error("配置文件需要修复，请到密钥页查看详情后再启动");
  if (service === "current") return dependencies.launchClient(req);

  if (service === "official") {
    if (!["official", "unconfigured"].includes(current.configurationStatus)) {
      const backupId = await dependencies.revertToOfficial(tool === "codex", tool === "claude");
      if (backupId) onConfigured({ backupId, paths: [], warnings: [], wroteCodexConfig: tool === "codex", wroteCodexAuth: false, wroteClaudeSettings: tool === "claude" });
    }
    const verified = (await dependencies.scanEnvironment(applyRequest.baseUrl))[tool];
    if (!["official", "unconfigured"].includes(verified.configurationStatus)) throw new Error("仍检测到自定义服务或外部认证覆盖，已停止启动。请检查配置详情，或明确选择沿用当前配置。");
  } else {
    const expectedModel = tool === "codex" ? applyRequest.model : applyRequest.claudeModel;
    const matches = current.configurationStatus === "configured" && current.activeProfileId === service
      && current.currentModel === expectedModel
      && (tool !== "codex" || env.codex.currentReasoningEffort === applyRequest.reasoningEffort);
    if (!matches) {
      onConfigured(await dependencies.applyConfig(applyRequest));
      const verified = (await dependencies.scanEnvironment(applyRequest.baseUrl))[tool];
      if (verified.configurationStatus !== "configured" || verified.activeProfileId !== service) {
        throw new Error("配置已写入，但仍有外部配置或认证覆盖，已停止启动。请查看配置详情；本次修改可撤销。");
      }
    }
  }
  return dependencies.launchClient(req);
}
