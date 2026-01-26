import 'cesium'

declare module 'cesium' {
  interface ScreenSpaceCameraController {
    minimumPitch?: number
    maximumPitch?: number
  }
}
