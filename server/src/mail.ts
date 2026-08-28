import nodemailer from "nodemailer";
import { config } from "./config.js";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

type MailSender = (message: MailMessage) => Promise<void>;

let transport: nodemailer.Transporter | null = null;

async function defaultMailSender(message: MailMessage): Promise<void> {
  if (!config.smtpUrl) {
    console.log("Syncbook email", message);
    return;
  }
  transport ??= nodemailer.createTransport(config.smtpUrl);
  await transport.sendMail({
    from: config.mailFrom,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}

let mailSender: MailSender = defaultMailSender;

export function setMailSender(sender: MailSender): void {
  mailSender = sender;
}

export function resetMailSender(): void {
  mailSender = defaultMailSender;
}

export async function sendMail(message: MailMessage): Promise<void> {
  try {
    await mailSender(message);
  } catch (error) {
    console.error("Failed to send email", error);
  }
}
