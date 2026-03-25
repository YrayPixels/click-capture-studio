
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Palette, Settings, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

type MainNavProps = React.HTMLAttributes<HTMLElement> & {
  centerContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  hideDefaultRight?: boolean;
};

export function MainNav({
  className,
  centerContent,
  rightContent,
  hideDefaultRight,
  ...props
}: MainNavProps) {
  // Use regular anchor tags for navigation when Link components aren't working
  return (
    <nav
      className={cn(
        "px-6 py-4",
        className
      )}
      {...props}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="flex items-center justify-start min-w-0">
          <a href="/" className="flex items-center gap-2 min-w-0">
            <Video className="h-6 w-6 text-studio-accent shrink-0" />
            <span className="font-bold text-xl truncate">Click Studio</span>
          </a>
        </div>

        <div className="flex items-center justify-center min-w-0">
          {centerContent ?? null}
        </div>

        <div className="flex items-center justify-end gap-4 min-w-0">
          {rightContent}
          {!hideDefaultRight ? (
            <>
              <Button variant="outline" size="icon" className="h-9 w-9">
                <Palette className="h-4 w-4" />
                <span className="sr-only">Appearance</span>
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" asChild>
                <a href="/settings">
                  <Settings className="h-4 w-4" />
                  <span className="sr-only">Settings</span>
                </a>
              </Button>
              <ThemeToggle />
            </>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
