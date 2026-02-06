// Keychain integration using the `keyring` crate.
// Stores database passwords in the OS-native credential store:
// - macOS: Keychain
// - Windows: Credential Manager
// - Linux: Secret Service (GNOME Keyring / KWallet)

const SERVICE_NAME: &str = "com.openquery.app";

pub fn set_password(profile_id: &str, password: &str) -> Result<(), Box<dyn std::error::Error>> {
    let entry = keyring::Entry::new(SERVICE_NAME, profile_id)?;
    entry.set_password(password)?;
    Ok(())
}

pub fn get_password(profile_id: &str) -> Result<Option<String>, Box<dyn std::error::Error>> {
    let entry = keyring::Entry::new(SERVICE_NAME, profile_id)?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_password(profile_id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let entry = keyring::Entry::new(SERVICE_NAME, profile_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone
        Err(e) => Err(e.into()),
    }
}
