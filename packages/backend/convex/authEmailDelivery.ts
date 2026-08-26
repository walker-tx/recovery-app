import {
  type PrivateGuidanceTemplateInput,
  type ResetTokenTemplateInput,
  type VerificationCodeTemplateInput,
  renderPrivateGuidance,
  renderResetToken,
  renderVerificationCode,
} from "./authEmailTemplates";

export const deliverVerificationCode = (input: VerificationCodeTemplateInput): void => {
  console.info("Auth credential delivery", renderVerificationCode(input));
};

export const deliverResetToken = (input: ResetTokenTemplateInput): void => {
  console.info("Auth credential delivery", renderResetToken(input));
};

export const deliverPrivateGuidance = (input: PrivateGuidanceTemplateInput): void => {
  console.info("Auth private guidance delivery", renderPrivateGuidance(input));
};
