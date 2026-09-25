function fmt(level: string, msg: string, extra?: unknown): string {
  const ts = new Date().toISOString();
  const tail = extra === undefined ? "" : " " + JSON.stringify(extra);
  return `${ts} ${level} ${msg}${tail}`;
}

export const log = {
  info: (msg: string, extra?: unknown) => console.log(fmt("INFO", msg, extra)),
  warn: (msg: string, extra?: unknown) => console.warn(fmt("WARN", msg, extra)),
  error: (msg: string, extra?: unknown) => console.error(fmt("ERROR", msg, extra)),
};
