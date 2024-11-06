
const args = getCmdArguments();
console.log("Argument received:", args);

const { ticket: issueKey, repo, ghToken, orgId, botId } = args;
const padNumber = (number) => number.toString().padStart(5, '0');

await (async function () {
    try {
        const issueDetails = await gitFetch(`https://api.github.com/repos/${repo}/issues/${issueKey}`);
        console.log("Done fetching issue details");

        const comments = issueDetails.comments ? await gitFetch(issueDetails.comments_url) : [];
        console.log("Done fetching issue comments");

        const repoLabels = await gitFetch(`https://api.github.com/repos/${repo}/labels`);
        console.log("Done fetching repo labels");

        const apiResponse = await callResponder(issueDetails, comments, repoLabels);
        console.log("Done getting response from bot");

        if (apiResponse.completionCost) {
            console.log("Cost incurred for processing this ticket", apiResponse.completionCost);
        }

        await updateGitHubIssue(issueDetails, apiResponse);
        console.log("Done with updating ticket");
    } catch (error) {
        console.error(`Error: ${error.message}`, error);
    }
})();


function gitFetch(url, body) {
    const options = { headers: { 'Content-Type': 'application/json' } };
    if (ghToken) {
        options.headers = { ...options.headers, Authorization: `token ${ghToken}` };
    }

    if (body) {
        options.method = 'POST';
        options.body = body;
    }

    return callAPI(url, options);
}

async function callAPI(url, options) {
    if (options?.body && typeof options.body === 'object') {
        options.body = JSON.stringify(options.body);
    }
    console.log('About to hit url: ', url);
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`Error calling API:`, url, response.statusText);
    return await response.json();
}

async function callResponder(issueDetails, comments, repoLabels) {
    const labels = issueDetails.labels.map(label => label.name);
    const { number, state, title, body } = issueDetails;

    let commentsContent = comments.map(comment =>
        `* ${comment.user.login} commented on ${new Date(comment.created_at).toISOString()}:\n${comment.body}`
    ).join('---------');

    if (commentsContent) {
        commentsContent = `Comments: ${commentsContent}`;
    }

    const queryDetails = `
Issue number:${number} (${state})
Title: ${title}
Labels: ${labels.join(',')}
Description: ${body}
${commentsContent}
`.trim();

    const requestBody = {
        customId: `g_issue_${padNumber(number)}`,
        queryDetails,
        labels: repoLabels?.map(label => ({ id: label.id, text: label.name, description: label.description }))
    };

    const basePath = 'https://335k3gia6uavyfimzvao2l6fzy0wuajw.lambda-url.ap-south-1.on.aws';
    //const basePath = 'http://localhost:5001';

    return await callAPI(`${basePath}/bot/${orgId}/${botId}/responder/github`,
        { headers: { 'Content-Type': 'application/json' }, method: 'POST', body: requestBody });
}

async function updateGitHubIssue(issueDetails, apiResponse) {
    const comment = apiResponse.comment && `${apiResponse.comment}\n\n---\n*This is an AI-generated response and there are possibilities of errors.*`;
    if (comment) {
        await gitFetch(`https://api.github.com/repos/${repo}/issues/${issueKey}/comments`, { body: comment });
    }

    let updateData = {};
    if (apiResponse.status && issueDetails.state !== apiResponse.status) {
        updateData.state = apiResponse.status;

        if (apiResponse.state_reason && apiResponse.state_reason !== 'null') {
            updateData.state_reason = apiResponse.state_reason;
        }
    }

    if (apiResponse.labels && apiResponse.labels.length > 0) {
        updateData.labels = apiResponse.labels;
    }

    if (Object.keys(updateData).length > 0) {
        await gitFetch(`https://api.github.com/repos/${issueDetails.repository_url}/issues/${issueKey}`, updateData);
    }
}


function getCmdArguments() {
    const args = process.argv.slice(2);
    const result = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg.startsWith('--')) {
            const key = arg.slice(2); // Remove the leading '--'
            const value = args[i + 1];

            // Check if the next item exists and is not another key
            if (value && !value.startsWith('--')) {
                result[key] = value;
                i++; // Increment i to skip the value
            } else {
                result[key] = true; // Default to true if no value
            }
        } else {
            console.error(`Invalid argument: ${arg}`);
            process.exit(1);
        }
    }

    return result;
}
