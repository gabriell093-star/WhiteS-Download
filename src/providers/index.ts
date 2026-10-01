import type { Provider } from "../core/provider.js";
import { SafelinkuProvider } from "./safelinku/safelinku.provider.js";
import { LinkvertiseProvider } from "./linkvertise/linkvertise.provider.js";
import { OuoProvider } from "./ouo/ouo.provider.js";
import { SfileProvider } from "./sfile/sfile.provider.js";
import { MegaupProvider } from "./megaup/megaup.provider.js";
import { DropgalaxyProvider } from "./dropgalaxy/dropgalaxy.provider.js";
import { TeraboxProvider } from "./terabox/terabox.provider.js";
import { DoodProvider } from "./dood/dood.provider.js";

export function createDefaultProviders(): Provider[] {
  return [
    new SafelinkuProvider(),
    new LinkvertiseProvider(),
    new OuoProvider(),
    new SfileProvider(),
    new MegaupProvider(),
    new DropgalaxyProvider(),
    new TeraboxProvider(),
    new DoodProvider()
  ];
}
