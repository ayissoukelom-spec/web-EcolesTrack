import React from 'react';

export default function SchoolSuspensionNotice() {
  return (
    <section
      role="alert"
      aria-labelledby="school-suspension-title"
      className="mb-5 rounded-lg border border-amber-700 bg-amber-950/50 p-4 text-sm text-amber-100"
    >
      <h2 id="school-suspension-title" className="mb-2 font-bold">
        Accès à votre établissement temporairement suspendu
      </h2>
      <p className="mb-3">
        L’accès à votre établissement sur EcolesTrack a été temporairement suspendu par l’administration de la plateforme.
      </p>
      <p className="mb-3">
        Pendant cette période, vous ne pouvez pas accéder aux fonctionnalités réservées à votre établissement. Vos données scolaires sont conservées.
      </p>
      <p className="mb-2">
        Pour obtenir des informations sur cette suspension ou demander la réactivation de votre compte, veuillez contacter l’administration d’EcolesTrack :
      </p>
      <ul className="mb-3 space-y-1">
        <li>
          <strong>Téléphone : </strong>
          <a className="underline underline-offset-2" href="tel:+22891551295">+228 91 55 12 95</a>
        </li>
        <li>
          <strong>E-mail : </strong>
          <a className="underline underline-offset-2" href="mailto:contact@ecolestrack.online">contact@ecolestrack.online</a>
        </li>
      </ul>
      <p className="mb-3">
        Nous vous invitons à prendre contact avec notre équipe pour obtenir une assistance.
      </p>
      <p className="font-semibold">Administration EcolesTrack</p>
    </section>
  );
}
