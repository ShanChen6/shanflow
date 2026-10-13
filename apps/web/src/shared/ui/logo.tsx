// The Shanflow mark: an "S" made of two flame-like ribbons (yellow → orange → red) and the wordmark (light on the dark theme).
// This is a hand-built SVG rendition of the brand artwork; swap it for the official files in /public/brand if they are provided.

const MARK_VIEWBOX = '410 175 470 750';

/** The two ribbons of the S. Ids are scoped per instance so several marks on one page never share a gradient by accident. */
export function LogoMark({ className, title = 'Shanflow' }: { className?: string; title?: string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} role="img" aria-label={title}>
      <defs>
        <linearGradient id="shanflow-top" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#FDB022" />
          <stop offset="0.55" stopColor="#FB7A3A" />
          <stop offset="1" stopColor="#FF5040" />
        </linearGradient>
        <linearGradient id="shanflow-bottom" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF6A45" />
          <stop offset="1" stopColor="#FF4D3F" />
        </linearGradient>
      </defs>
      <path
        fill="url(#shanflow-top)"
        d="M848 182C860 260 800 380 660 425C610 440 575 460 578 485C590 505 680 520 740 540C840 570 885 640 862 700C850 760 790 810 738 830C772 795 780 748 742 712C690 662 604 630 520 598C462 574 432 535 437 482C445 400 520 322 640 277C740 240 812 232 848 182Z"
      />
      <path
        fill="url(#shanflow-bottom)"
        d="M420 534C446 600 530 636 612 670C690 702 730 714 746 745C754 775 740 805 722 826C650 858 520 872 428 918C452 848 520 800 596 762C628 744 626 716 598 706C528 664 436 608 420 534Z"
      />
    </svg>
  );
}

/** Mark and wordmark side by side. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <LogoMark className="h-8 w-auto" title="" />
      <span className="text-xl font-extrabold tracking-tight text-slate-900">Shanflow</span>
    </span>
  );
}
