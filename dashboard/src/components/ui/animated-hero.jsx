import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MoveRight, PhoneCall } from "lucide-react";
import { Button } from "./button";

export function AnimatedHeroTitle({ onStart, onLogin, onContact }) {
    const [titleNumber, setTitleNumber] = useState(0);
    const titles = useMemo(
        () => ["every call", "more jobs", "lost revenue", "every lead", "more bookings"],
        []
    );

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            setTitleNumber((prev) => (prev === titles.length - 1 ? 0 : prev + 1));
        }, 2000);
        return () => clearTimeout(timeoutId);
    }, [titleNumber, titles]);

    return (
        <div className="w-full">
            <div className="flex gap-6 py-4 lg:py-8 items-center justify-center flex-col mb-4">
                <div>
                    <Button variant="secondary" size="sm" className="gap-2 text-stone-700 border border-stone-200">
                        Built for home service contractors <MoveRight className="w-4 h-4" />
                    </Button>
                </div>
                <div className="flex gap-3 flex-col">
                    <h1 className="text-5xl md:text-6xl max-w-2xl tracking-tight text-center font-bold text-stone-900">
                        Never miss
                        <span className="relative flex w-full justify-center overflow-hidden text-center md:pb-4 md:pt-1 h-[1.2em]">
                            &nbsp;
                            {titles.map((title, index) => (
                                <motion.span
                                    key={index}
                                    className="absolute font-bold text-brand-600"
                                    initial={{ opacity: 0, y: 80 }}
                                    transition={{ type: "spring", stiffness: 60, damping: 20 }}
                                    animate={
                                        titleNumber === index
                                            ? { y: 0, opacity: 1 }
                                            : { y: titleNumber > index ? -80 : 80, opacity: 0 }
                                    }
                                >
                                    {title}
                                </motion.span>
                            ))}
                        </span>
                    </h1>
                    <p className="text-lg md:text-xl leading-relaxed tracking-tight text-stone-600 max-w-2xl text-center mx-auto">
                        Answer every call. Book more jobs. Recover lost revenue - automatically
                        Your AI front desk handles calls, qualifies leads, schedules work, and follows up.
                    </p>
                </div>
                <div className="flex flex-row gap-3 mt-2 relative z-[101] pointer-events-auto isolate">
  <Button
    type="button"
    size="lg"
    className="gap-3 relative z-[102]"
    variant="outline"
    onClick={() => {
      console.log("Get in touch clicked");
      onContact?.();
    }}
  >
    Get in touch <PhoneCall className="w-4 h-4" />
  </Button>

  <Button
    type="button"
    size="lg"
    className="gap-3 relative z-[102]"
    onClick={onStart}
  >
    Start free <MoveRight className="w-4 h-4" />
  </Button>
</div>
            </div>
        </div>
    );
}
