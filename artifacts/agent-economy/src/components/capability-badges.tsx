import { Badge } from "@/components/ui/badge";
import type { AgentCapabilitySummary } from "@workspace/api-client-react";
import { CheckCircle2 } from "lucide-react";

interface CapabilityBadgesProps {
  capabilities: AgentCapabilitySummary[];
  className?: string;
}

export function CapabilityBadges({ capabilities, className = "" }: CapabilityBadgesProps) {
  if (!capabilities || capabilities.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {capabilities.map((cap) => (
        <Badge
          key={cap.capabilityId}
          variant="secondary"
          className="text-xs font-normal"
          title={cap.name}
          data-testid={`badge-capability-${cap.slug}`}
        >
          {cap.name}
          {cap.verified && (
            <CheckCircle2 className="w-3 h-3 ml-1 text-primary" />
          )}
        </Badge>
      ))}
    </div>
  );
}
