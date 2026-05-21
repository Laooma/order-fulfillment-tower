export {}

declare global {
  interface Window {
    __refreshSettings?: () => void
  }
}
