// Replays a terminal panel's recorded frames over its static copy: types the
// command, then steps through the screens the real run produced, each held for
// as long as the scenario said. Plays once, when the panel first comes into
// view. Nothing moves for a reader who prefers reduced motion; they get the
// finished output that is already in the page.

interface Payload {
  command: string;
  frames: Array<[hold: number, html: string]>;
  speed: number;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function enhance(figure: HTMLElement): void {
  const raw = figure.dataset.terminal;
  if (!raw || figure.dataset.enhanced) return;
  figure.dataset.enhanced = '1';
  const payload = JSON.parse(raw) as Payload;
  const body = figure.querySelector<HTMLElement>('.body')!;
  const controls = figure.querySelector<HTMLElement>('[data-controls]');
  const pauseButton = figure.querySelector<HTMLButtonElement>('[data-action="pause"]');
  const replayButton = figure.querySelector<HTMLButtonElement>('[data-action="replay"]');

  let run: AbortController | undefined;
  let paused = false;
  let resume: (() => void) | undefined;

  const anim = document.createElement('pre');
  anim.dataset.anim = '';
  anim.setAttribute('aria-hidden', 'true');

  // Waits out a hold, and waits longer while the reader has the demo paused.
  const hold = async (ms: number, signal: AbortSignal) => {
    await sleep(ms / payload.speed, signal);
    while (paused && !signal.aborted) await new Promise<void>((r) => (resume = r));
    signal.throwIfAborted();
  };

  const stop = () => {
    run?.abort(new DOMException('stopped', 'AbortError'));
    run = undefined;
    // Wakes a run parked on pause, so it sees the abort and ends.
    resume?.();
    anim.remove();
    delete body.dataset.playing;
  };

  const play = async () => {
    stop();
    paused = false;
    syncPause();
    const controller = (run = new AbortController());
    const { signal } = controller;
    body.dataset.playing = '';
    body.append(anim);
    const prompt = '<span class="prompt">$ </span>';
    try {
      // Typed at a human pace, but never for more than about a second and a
      // half: a long command is not more interesting for taking longer.
      const step = Math.min(45, 1400 / payload.command.length);
      for (let i = 0; i <= payload.command.length; i++) {
        anim.innerHTML = `${prompt}<span class="cmd">${escape(payload.command.slice(0, i))}</span><span class="cursor"></span>`;
        await hold(step, signal);
      }
      await hold(350, signal);
      const head = `${prompt}<span class="cmd">${escape(payload.command)}</span>\n`;
      for (const [ms, html] of payload.frames) {
        anim.innerHTML = head + html;
        await hold(ms, signal);
      }
      await hold(400, signal);
      stop();
    } catch {
      // Aborted by replay or by stop; whoever aborted owns what happens next.
    }
  };

  const syncPause = () => {
    if (!pauseButton) return;
    pauseButton.setAttribute('aria-label', paused ? 'Resume the demo' : 'Pause the demo');
    pauseButton.setAttribute('aria-pressed', String(paused));
  };

  pauseButton?.addEventListener('click', () => {
    if (!run) return;
    paused = !paused;
    syncPause();
    if (!paused) resume?.();
  });
  replayButton?.addEventListener('click', () => void play());

  if (reduced()) return;
  if (controls) controls.hidden = false;
  const seen = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      void play();
    },
    { threshold: 0.4 },
  );
  seen.observe(figure);
}
