import { App } from "aws-cdk-lib";
import { BookingsStack } from "../lib/bookings-stack";

const app = new App();
new BookingsStack(app, "BookingsProd", { env: { account: "111111111111", region: "us-east-1" } });
new BookingsStack(app, "BookingsStaging", {
  env: { account: "222222222222", region: "us-east-2" },
});
