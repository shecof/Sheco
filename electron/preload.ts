import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI } from '../src/shared/api'
const api: DesktopAPI = {
  platform: process.platform,
  setLanguage: (language) => ipcRenderer.invoke('set-language', language),
  boot: () => ipcRenderer.invoke('boot'),
  save: (w, r) => ipcRenderer.invoke('save', w, r),
  switchSpace: (id) => ipcRenderer.invoke('switch-space', id),
  createSpace: (name) => ipcRenderer.invoke('create-space', name),
  openSpace: () => ipcRenderer.invoke('open-space'),
  renameSpace: (name) => ipcRenderer.invoke('rename-space', name),
  attach: () => ipcRenderer.invoke('attach'),
  attachBytes: (name, bytes) => ipcRenderer.invoke('attach-bytes', name, bytes),
  openAttachment: (id) => ipcRenderer.invoke('open-attachment', id),
  external: (url) => ipcRenderer.invoke('external', url),
  exportPage: (id, format) => ipcRenderer.invoke('export-page', id, format),
  exportDatabase: (id) => ipcRenderer.invoke('export-database', id),
  exportWorkspace: () => ipcRenderer.invoke('export-workspace'),
  backup: () => ipcRenderer.invoke('backup'),
  recovery: (w) => ipcRenderer.invoke('recovery', w),
  importMarkdown: () => ipcRenderer.invoke('import-markdown'),
  showFolder: () => ipcRenderer.invoke('show-folder'),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  importPluginSettings: () => ipcRenderer.invoke('import-plugin-settings'),
  exportPluginSettings: (config) => ipcRenderer.invoke('export-plugin-settings', config),
  mcpStatus: () => ipcRenderer.invoke('mcp-status'),
  configureMcp: (config) => ipcRenderer.invoke('mcp-configure', config),
  rotateMcpToken: () => ipcRenderer.invoke('mcp-rotate-token'),
  replyMcp: (reply) => ipcRenderer.invoke('mcp-reply', reply),
  onMcpRequest: (callback) => {
    const listener = (_event: unknown, request: Parameters<typeof callback>[0]) => callback(request)
    ipcRenderer.on('mcp-request', listener)
    return () => ipcRenderer.removeListener('mcp-request', listener)
  },
  onClose: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('close-request', listener)
    return () => ipcRenderer.removeListener('close-request', listener)
  },
  onMenu: (callback) => {
    const listener = (_event: unknown, action: string) => callback(action)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  },
  readyToClose: () => ipcRenderer.send('ready-close'),
}
contextBridge.exposeInMainWorld('sheco', api)
