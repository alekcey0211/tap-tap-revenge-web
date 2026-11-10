export async function chooseBackend({ preference = 'auto', supported, webgpu, webgl }) {
  if (preference !== 'webgl') {
    try {
      if (await supported()) return { ...(await webgpu()), fallback: false };
    } catch { /* A fresh canvas is created by the WebGL factory after failed GPU initialization. */ }
  }
  return { ...(await webgl()), fallback: preference !== 'webgl' };
}
