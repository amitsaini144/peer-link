// Redraws a captured tab onto a fixed-size canvas, fitted and letterboxed.
// The tab's own size is whatever the window happens to be (e.g. 1920×963)
// and can change mid-recording; encoders pad odd sizes, which some players
// (Windows Media Player) show as a green strip. A fixed frame size avoids both.
export function createFixedSizeVideoTrack(source: MediaStream, width: number, height: number, fps: number) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = source;
  video.play().catch(() => {});

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false })!;
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);

  const draw = () => {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return;
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = Math.round(sourceWidth * scale);
    const drawHeight = Math.round(sourceHeight * scale);
    context.fillRect(0, 0, width, height);
    context.drawImage(video, Math.floor((width - drawWidth) / 2), Math.floor((height - drawHeight) / 2), drawWidth, drawHeight);
  };

  // Driven from a worker: the page's own timers and requestAnimationFrame are
  // throttled or paused when the user switches to another tab.
  const tickerUrl = URL.createObjectURL(new Blob(
    [`setInterval(() => postMessage(0), ${Math.round(1000 / fps)});`],
    { type: 'text/javascript' },
  ));
  const ticker = new Worker(tickerUrl);
  ticker.onmessage = draw;

  const [track] = canvas.captureStream(fps).getVideoTracks();

  const stop = () => {
    ticker.terminate();
    URL.revokeObjectURL(tickerUrl);
    track.stop();
    video.pause();
    video.srcObject = null;
  };

  return { track, stop };
}
