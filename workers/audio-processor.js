class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      this.port.postMessage({ pcm: input[0] });
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
