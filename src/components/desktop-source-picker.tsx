import * as React from "react";
import { Monitor, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

export type DesktopSourcePick = {
  id: string;
  name: string;
  thumbnailDataUrl: string;
};

export function DesktopSourcePicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (source: DesktopSourcePick) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [sources, setSources] = React.useState<DesktopSourcePick[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    if (!window.clickStudio?.getDesktopSources) {
      setSources([]);
      setError("Desktop source listing is unavailable in this environment.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    window.clickStudio
      .getDesktopSources()
      .then((s) => {
        if (cancelled) return;
        setSources(s);
      })
      .catch((e) => {
        if (cancelled) return;
        const err = e as { message?: string };
        setError(err?.message ?? "Failed to list windows/screens.");
        setSources([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter((s) => s.name.toLowerCase().includes(q));
  }, [query, sources]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] p-0 overflow-hidden">
        <div className="p-6 border-b">
          <DialogHeader>
            <DialogTitle className="text-xl">Select what to record</DialogTitle>
          </DialogHeader>
          <div className="mt-4 flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search windows and screens…"
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setError(null);
                setSources([]);
                setLoading(true);
                window.clickStudio
                  ?.getDesktopSources?.()
                  .then((s) => setSources(s))
                  .catch((e) => {
                    const err = e as { message?: string };
                    setError(err?.message ?? "Failed to refresh sources.");
                  })
                  .finally(() => setLoading(false));
              }}
              disabled={!window.clickStudio?.getDesktopSources}
            >
              Refresh
            </Button>
          </div>
        </div>

        <div className="p-6">
          {error ? (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              {error}
            </div>
          ) : loading ? (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              Listing windows and screens…
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              No sources found.
            </div>
          ) : (
            <ScrollArea className="h-[420px] pr-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="group rounded-xl border bg-card overflow-hidden text-left hover:shadow-md transition-shadow"
                    onClick={() => onPick(s)}
                  >
                    <div className="relative aspect-video bg-black">
                      {s.thumbnailDataUrl ? (
                        <img
                          src={s.thumbnailDataUrl}
                          alt=""
                          className="h-full w-full object-cover opacity-95 group-hover:opacity-100 transition-opacity"
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-white/60">
                          <Monitor className="h-8 w-8" />
                        </div>
                      )}
                      <div className="absolute inset-0 ring-0 group-hover:ring-2 ring-primary/70 transition-[ring] pointer-events-none" />
                    </div>
                    <div className="p-3">
                      <div className="text-sm font-medium line-clamp-1">{s.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {s.id.startsWith("screen:") ? "Entire screen" : "Window"}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
