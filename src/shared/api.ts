import type { Attachment, BootData, Workspace } from './model'
import type { McpConfig, McpStatus, McpRequest, McpReply } from './mcp'
import type { CommandBuilderConfig } from './plugins'
export interface DesktopAPI {
  platform: string
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
