import React from "react";

const loaderStyles = `
@keyframes lumaLoaderAnim {
  0%   { inset: 0 35px 35px 0; }
  12.5%{ inset: 0 35px 0 0; }
  25%  { inset: 35px 35px 0 0; }
  37.5%{ inset: 35px 0 0 0; }
  50%  { inset: 35px 0 0 35px; }
  62.5%{ inset: 0 0 0 35px; }
  75%  { inset: 0 0 35px 35px; }
  87.5%{ inset: 0 0 35px 0; }
  100% { inset: 0 35px 35px 0; }
}
.luma-spin-el {
  position: absolute;
  border-radius: 50px;
  box-shadow: inset 0 0 0 3px #44403c;
  animation: lumaLoaderAnim 2.5s infinite;
}
.luma-spin-el-delayed {
  animation-delay: -1.25s;
}
`;

export function LumaSpin({ className = "" }) {
    return (
        <div className={`relative w-[65px] aspect-square ${className}`}>
            <style>{loaderStyles}</style>
            <span className="luma-spin-el" />
            <span className="luma-spin-el luma-spin-el-delayed" />
        </div>
    );
}
