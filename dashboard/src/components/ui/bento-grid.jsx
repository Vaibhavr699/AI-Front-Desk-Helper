import { cn } from "../../lib/utils";
import { Button } from "./button";
import { ArrowRightIcon } from "@radix-ui/react-icons";

const BentoGrid = ({ children, className }) => {
    return (
        <div
            className={cn(
                "grid w-full auto-rows-[14rem] grid-cols-3 gap-4",
                className
            )}
        >
            {children}
        </div>
    );
};

const BentoCard = ({ name, className, background, Icon, description, href, cta }) => (
    <div
        key={name}
        className={cn(
            "group relative col-span-3 flex flex-col justify-between overflow-hidden rounded-xl",
            "bg-white [box-shadow:0_0_0_1px_rgba(0,0,0,.03),0_2px_4px_rgba(0,0,0,.05),0_12px_24px_rgba(0,0,0,.05)]",
            "transform-gpu",
            className
        )}
    >
        <div>{background}</div>
        <div className="pointer-events-none z-10 flex transform-gpu flex-col gap-1 p-6 transition-all duration-300 group-hover:-translate-y-10">
            <Icon className="h-12 w-12 origin-left transform-gpu text-stone-700 transition-all duration-300 ease-in-out group-hover:scale-75" />
            <h3 className="text-xl font-semibold text-stone-800">
                {name}
            </h3>
            <p className="max-w-lg text-stone-500">{description}</p>
        </div>

        <div
            className={cn(
                "pointer-events-none absolute bottom-0 flex w-full translate-y-10 transform-gpu flex-row items-center p-4 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
            )}
        >
            <Button variant="ghost" asChild size="sm" className="pointer-events-auto">
                <a href={href}>
                    {cta}
                    <ArrowRightIcon className="ml-2 h-4 w-4" />
                </a>
            </Button>
        </div>
        <div className="pointer-events-none absolute inset-0 transform-gpu transition-all duration-300 group-hover:bg-black/[.03]" />
    </div>
);

export { BentoCard, BentoGrid };
