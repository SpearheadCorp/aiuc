import { useState, useEffect } from "react";
import { userPool } from "../config/cognito";

interface CognitoUserInfo {
  userName: string;
  userEmail: string;
  isRegistered: boolean;
  isChecking: boolean;
}

export function useCognitoUser(): CognitoUserInfo {
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [isRegistered, setIsRegistered] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    if (!userPool) {
      console.warn("[useCognitoUser] Cognito not configured — running without auth");
      setIsChecking(false);
      return;
    }

    const user = userPool.getCurrentUser();

    if (!user) {
      setIsChecking(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user.getSession((err: Error | null, session: any) => {
      if (err) {
        console.warn("[useCognitoUser] getSession error:", err.message);
      } else if (session?.isValid()) {
        const payload = session.getIdToken().decodePayload();
        setUserName((payload.name as string) || (payload.email as string) || "");
        setUserEmail((payload.email as string) || "");
        setIsRegistered(true);
      }
      setIsChecking(false);
    });
  }, []);

  return { userName, userEmail, isRegistered, isChecking };
}
