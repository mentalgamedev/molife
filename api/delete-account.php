<?php
declare(strict_types=1);
require __DIR__ . '/auth/bootstrap.php';

dalli_require_method('POST');
dalli_require_same_origin();

$pdo = dalli_pdo();
$userId = dalli_require_active_user($pdo);
dalli_require_csrf();

$body = dalli_read_json_body();
$password = (string) ($body['password'] ?? '');
$confirmation = trim((string) ($body['confirmation'] ?? ''));

if (strlen($password) < 1 || strlen($password) > 200 || strlen($confirmation) > 64) {
    dalli_fail('Account deletion confirmation is invalid.', 422);
}

$stmt = $pdo->prepare(
    "SELECT id, username, password_hash, role, status
     FROM users
     WHERE id = ?
     LIMIT 1"
);
$stmt->execute([$userId]);
$user = $stmt->fetch();

if (!is_array($user) || (string) ($user['status'] ?? '') !== 'active') {
    dalli_fail('Authentication required.', 401);
}

if ((string) ($user['role'] ?? 'user') === 'owner') {
    dalli_fail('The owner account cannot be deleted until ownership transfer is supported.', 403);
}

$username = (string) $user['username'];
if ($confirmation === '' || !hash_equals($username, $confirmation)) {
    dalli_fail('Type your username exactly to confirm account deletion.', 422);
}

if (!password_verify($password, (string) $user['password_hash'])) {
    dalli_fail('Current password is incorrect.', 401);
}

try {
    $pdo->beginTransaction();

    $delete = $pdo->prepare(
        "DELETE FROM users
         WHERE id = ? AND role <> 'owner' AND status = 'active'"
    );
    $delete->execute([$userId]);

    if ($delete->rowCount() !== 1) {
        $pdo->rollBack();
        dalli_fail('Account could not be deleted.', 409);
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('MoLife account deletion failed for user ' . $userId . ': ' . $e->getMessage());
    dalli_fail('Could not delete account.', 500);
}

// Foreign-key cascades remove cloud state, remembered sessions and auth tokens.
// Clear this browser's cookies/session after the database commit succeeds.
dalli_clear_remember_cookie();
$_SESSION = [];

if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(DALLI_SESSION_NAME, '', [
        'expires' => time() - 42000,
        'path' => $params['path'] ?: '/',
        'domain' => $params['domain'] ?? '',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

session_destroy();

dalli_json_response([
    'ok' => true,
    'deleted' => true,
]);
