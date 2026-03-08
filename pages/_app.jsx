import '../styles/globals.css';
import { useEffect } from 'react';

export default function MyApp({ Component, pageProps }) {
  useEffect(() => {
    // Microsoft Clarity — session recordings & heatmaps
    // var declarations required — Next.js strict mode throws on undeclared variables
    (function(c,l,a,r,i){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      var t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
      var y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window,document,"clarity","script","vsgr8xq73h");
  }, []);

  return <Component {...pageProps} />;
}
