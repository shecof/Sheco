import type { Attachment, BootData, Workspace } from './model'
import type { McpConfig, McpStatus, McpRequest, McpReply } from './mcp'
import type { CommandBuilderConfig } from './plugins'
import type { JiraCredentialStatus, JiraCredentialsInput, JiraIssue } from './jira'
import type { UpdateResult, AppUpdateState, UpdateSettings } from './appUpdates'
export interface DesktopAPI {
  platform: string
  appVersion(): Promise<string>
  checkUpdates(): Promise<UpdateResult>
  updateState(): Promise<AppUpdateState>
  configureUpdates(settings: UpdateSettings): Promise<AppUpdateState>
  onUpdateState(callback: (state: AppUpdateState) => void): () => void
  setLanguage(language: 'en' | 'ru'): Promise<void>
  boot(): Promise<BootData>
  save(
    workspace: Workspace,
    expectedRevision: number,
  ): Promise<{ revision: number; updatedAt: string }>
  switchSpace(id: string): Promise<BootData>
  createSpace(name: string): Promise<BootData | null>
  openSpace(): Promise<BootData | null>
  renameSpace(name: string): Promise<void>
  attach(): Promise<Attachment[]>
  attachBytes(name: string, bytes: ArrayBuffer): Promise<Attachment>
  openAttachment(id: string): Promise<void>
  readPreviewPdf(input: { workspaceId: string; attachmentId: string }): Promise<ArrayBuffer>
  readPreviewText(input: { workspaceId: string; attachmentId: string }): Promise<string>
  external(url: string): Promise<void>
  exportPage(id: string, format: 'markdown' | 'pdf'): Promise<string | null>
  exportDatabase(id: string): Promise<string | null>
  exportWorkspace(): Promise<string | null>
  backup(): Promise<string>
  importMarkdown(): Promise<{ title: string; text: string } | null>
  recovery(workspace: Workspace): Promise<string | null>
  showFolder(): Promise<void>
  copyText(text: string): Promise<void>
  importPluginSettings(): Promise<CommandBuilderConfig | null>
  exportPluginSettings(config: CommandBuilderConfig): Promise<string | null>
  jiraStatus(workspaceId: string, baseUrl?: string): Promise<JiraCredentialStatus>
  configureJira(input: JiraCredentialsInput): Promise<void>
  forgetJiraToken(workspaceId: string, baseUrl?: string): Promise<void>
  jiraIssue(input: { workspaceId: string; baseUrl: string; issueKey: string }): Promise<JiraIssue>
  mcpStatus(): Promise<McpStatus>
  configureMcp(config: McpConfig): Promise<McpStatus>
  rotateMcpToken(): Promise<McpStatus>
  onMcpRequest(callback: (request: McpRequest) => void): () => void
  replyMcp(reply: McpReply): Promise<void>
  onClose(callback: () => void): () => void
  onMenu(callback: (action: string) => void): () => void
  readyToClose(): void
}
declare global {
  interface Window {
    sheco: DesktopAPI
  }
}
