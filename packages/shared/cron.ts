const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad(n: string) {
  return n.padStart(2, '0');
}

/** Best effort human text for common 5-field crons; falls back to the raw expression. */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  const num = /^\d+$/;

  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${min.slice(2)} minutes`;
  }
  if (num.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return min === '0' ? 'Every hour' : `Every hour at :${pad(min)}`;
  }
  if (num.test(min) && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${hour.slice(2)} hours`;
  }
  if (!num.test(min)) return cron;
  const hours = hour.split(',');
  if (!hours.every((h) => num.test(h))) return cron;
  const at = hours.map((h) => `${pad(h)}:${pad(min)}`).join(', ');

  if (mon !== '*') return cron;
  if (dom === '*' && dow === '*') return `Every day at ${at}`;
  if (dom === '*') {
    if (dow === '1-5' || dow === 'MON-FRI') return `Weekdays at ${at}`;
    if (dow === '0,6' || dow === '6,0' || dow === 'SAT,SUN') return `Weekends at ${at}`;
    const days = dow.split(',');
    if (days.every((x) => num.test(x) && Number(x) <= 7)) {
      return `${days.map((x) => DOW[Number(x) % 7] + 's').join(', ')} at ${at}`;
    }
    return cron;
  }
  if (num.test(dom) && dow === '*') return `Day ${dom} of every month at ${at}`;
  return cron;
}
