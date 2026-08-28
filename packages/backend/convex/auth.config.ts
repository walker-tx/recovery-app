import { buildWorkOSAuthConfig } from "./workosAuthConfig";

export default buildWorkOSAuthConfig({
  mode: process.env.WORKOS_MODE,
  workosClientId: process.env.WORKOS_CLIENT_ID,
});
