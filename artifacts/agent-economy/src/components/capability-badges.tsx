import { Badge } from "@/components/ui/badge";
import type { AgentCapabilitySummary } from "@workspace/api-client-react";
import { CheckCircle2, Clock } from "lucide-react";

interface CapabilityBadgesProps {
  capabilities: AgentCapabilitySummary[];
  className?: string;
}

export function CapabilityBadges({ capabilities, className = "" }: CapabilityBadgesProps) {
  if (!capabilities || capabilities.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {capabilities.map((cap) => {
        if (cap.verified) {
          return (
            <Badge
              key={cap.capabilityId}
              variant="secondary"
              className="text-xs font-normal bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"
              title={`${cap.name} — Verified${cap.verifiedScore != null ? ` (score: ${cap.verifiedScore})` : ""}`}
              data-testid={`badge-capability-${cap.slug}`}
            >
              {cap.name}
              <CheckCircle2 className="w-3 h-3 ml-1 text-green-600 dark:text-green-400" />
            </Badge>
          );
        }

        if (cap.verifiedScore != null) {
          return (
            <Badge
              key={cap.capabilityId}
              variant="secondary"
              className="text-xs font-normal bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800"
              title={`${cap.name} — Pending verification (benchmark score: ${cap.verifiedScore})`}
              data-testid={`badge-capability-${cap.slug}`}
            >
              {cap.name}
              <span className="ml-1 text-amber-600 dark:text-amber-400 text-[10px]">{cap.verifiedScore}</span>
              <Clock className="w-3 h-3 ml-0.5 text-amber-500" />
            </Badge>
          );
        }

        return (
          <Badge
            key={cap.capabilityId}
            variant="secondary"
            className="text-xs font-normal"
            title={cap.name}
            data-testid={`badge-capability-${cap.slug}`}
          >
            {cap.name}
          </Badge>
        );
      })}
    </div>
  );
}
