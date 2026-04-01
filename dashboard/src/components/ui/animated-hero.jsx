import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MoveRight, PhoneCall, Sparkles } from "lucide-react";
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
                <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-emerald-50 border border-emerald-100 shadow-sm hover:shadow-md transition-all cursor-default group">
                        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-emerald-200 shadow-lg">
                            <Sparkles className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[12px] font-bold text-emerald-900 tracking-tight">Built for Home Service Contractors</span>
                            <MoveRight className="w-3.5 h-3.5 text-emerald-600 group-hover:translate-x-0.5 transition-transform" />
                        </div>                        
                    </div>
                </motion.div>
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
                <div className="flex flex-row gap-3 mt-4 relative z-50 pointer-events-auto">
                    <button
                        type="button"
                        onClick={() => {
                            if (onContact) {
                                onContact();
                            }
                        }}
                        className="px-6 py-2 border border-stone-300 bg-white rounded-xl flex items-center gap-2 hover:bg-stone-50 transition-colors"
                    >
                        <span>Get in touch</span>
                        <PhoneCall className="w-4 h-4" />
                    </button>

                    <Button
                        type="button"
                        size="lg"
                        className="gap-3 rounded-xl shadow-lg hover:shadow-xl transition-all"
                        onClick={onStart}
                    >
                        Start free <MoveRight className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
